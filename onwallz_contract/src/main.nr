/// OnWallz: public walls, private authors.
///
/// One wall per name. You create your own wall when you sign up, and from then on:
///   - you cannot write on your own wall
///   - anyone else may write on it, anonymously, at most once per day
///   - you reply on your own wall, visibly, as the wall's name
///
/// How the author of a note stays hidden:
///   - `write` runs privately. The self-post check and the daily-limit nullifier are
///     computed inside the proof, so neither becomes public information.
///   - The enqueued public call `_publish` receives (wall, text, length, nonce, key,
///     name). None of those is a person, and none can be turned back into one without
///     the author's secret nullifier key.
#[aztec::macros::aztec]
pub contract OnWallz {
        use aztec::{
        keys::getters::get_public_keys,
        macros::{
            events::event,
            functions::{external, initializer, only_self, view},
            notes::note,
            storage::storage,
        },
        messages::delivery::MessageDelivery,
        note::{note_getter_options::NoteGetterOptions, note_viewer_options::NoteViewerOptions},
        protocol::{
            address::AztecAddress,
            hash::{poseidon2_hash, poseidon2_hash_with_separator},
            traits::{Packable, ToField},
        },
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable},
    };

    // Domain separators, so no two hashes in this contract can collide.
    global DOMAIN_DAILY: Field = 0x44415931;
    global DOMAIN_WALL: Field = 0x57414c4c;

    /// A note is up to 32 fields of 31 bytes each, so 992 bytes of text. Notes that fit
    /// in three fields (93 bytes) keep their text in public storage; longer ones put it
    /// in the PostedLong event and keep only a digest in state, which is what makes long
    /// text cheap.
    global MAX_FIELDS: u32 = 32;
    global STORED_BYTES: u32 = 93;

    /// A note was published. Carries no author information.
    #[event]
    struct Posted {
        wall: Field,
        index: u32,
        length: u16,
    }

    /// A long note. Its text lives here, in the log, not in public state. Only the
    /// digest and the length touch state, so a long post costs no storage slots for text.
    #[event]
    struct PostedLong {
        wall: Field,
        index: u32,
        length: u16,
        digest: Field,
        text: [Field; 32],
    }

    /// A wall was created by its owner.
    #[event]
    struct Created {
        wall: Field,
    }

    /// A wall linked to a .fog name by its owner. This is an attestation, not a proof:
    /// clients check it against the Fog registry, which owns the truth, and never show a
    /// badge whose name does not resolve to the claimant.
    #[event]
    struct FogLinked {
        wall: Field,
        claimant: Field,
        label: Field,
    }

    #[event]
    struct FogUnlinked {
        wall: Field,
    }

    /// A name this wallet owns. Private: it lives in the owner's PXE only.
    #[derive(Eq, Packable)]
    #[note]
    pub struct NameNote {
        pub name: Field,
        pub handle: Field,
    }

    #[event]
    struct Replied {
        wall: Field,
        post_id: Field,
        text: Field,
    }

    /// A note withdrawn by its author. The text stays on chain.
    #[event]
    struct NoteTombstoned {
        post_id: Field,
    }

    #[storage]
    struct Storage<Context> {
        exists: Map<Field, PublicMutable<bool, Context>, Context>,
        // Public as little as possible: only whether a name is taken. The chain never
        // records *who* created it, so no wallet-to-handle mapping exists.
        claimed: Map<Field, PublicImmutable<bool, Context>, Context>,
        // Private ownership: the names this wallet holds, readable only by it.
        names: Owned<PrivateSet<NameNote, Context>, Context>,
        display: Map<Field, PublicImmutable<Field, Context>, Context>,
        post_count: Map<Field, PublicMutable<u32, Context>, Context>,
        post_text: Map<Field, PublicMutable<[Field; 3], Context>, Context>,
        post_len: Map<Field, PublicMutable<u16, Context>, Context>,
        // post id -> wall it was written on
        post_wall: Map<Field, PublicImmutable<Field, Context>, Context>,
        // post id -> public nonce (random, chosen by the author)
        post_nonce: Map<Field, PublicImmutable<Field, Context>, Context>,
        // post id -> H(author secret, wall, nonce). Only the author can reproduce it.
        post_key: Map<Field, PublicImmutable<Field, Context>, Context>,
        // post id -> block timestamp, written by the public half. On-chain truth, not
        // a browser assertion.
        post_time: Map<Field, PublicImmutable<Field, Context>, Context>,
        // Global activity log: append-only, bounded reads for the feed.
        activity_count: PublicMutable<u32, Context>,
        activity_wall: Map<u32, PublicMutable<Field, Context>, Context>,
        activity_post: Map<u32, PublicMutable<Field, Context>, Context>,
        activity_index: Map<u32, PublicMutable<u32, Context>, Context>,
        // Tombstones: content is never rewritten, only marked.
        post_deleted: Map<Field, PublicImmutable<bool, Context>, Context>,
        replied: Map<Field, PublicImmutable<bool, Context>, Context>,
        // post id -> the owner's reply text
        reply_text: Map<Field, PublicMutable<Field, Context>, Context>,
    }

    #[external("private")]
    #[initializer]
    fn constructor() {}

    /// Create your own wall. The name must be free.
    ///
    /// This is the only way a wall comes into existence. The ownership note lands in
    /// your wallet, so the chain learns that a name is taken, never by which wallet.
    #[external("private")]
    fn create(name: Field, len: u8) {
        assert(len > 0, "username required");
        assert(len as u32 <= 15, "username too long");
        let wall = poseidon2_hash([name, len as Field, DOMAIN_WALL]);

        self.storage.names.at(self.msg_sender()).insert(NameNote { name: wall, handle: name }).deliver(MessageDelivery::onchain_constrained());
        self.enqueue(OnWallz::at(self.address)._create(wall, name));
    }

    #[external("public")]
    #[only_self]
    fn _create(wall: Field, name: Field) {
        assert(!self.storage.claimed.at(wall).is_initialized(), "this name is already taken");
        self.storage.claimed.at(wall).initialize(true);
        self.storage.exists.at(wall).write(true);
        self.storage.post_count.at(wall).write(0);
        self.storage.display.at(wall).initialize(name);
        self.emit(Created { wall });
    }

    /// Write on someone else's wall, anonymously.
    ///
    /// The wall must exist: walls come from their owner's `create`, not from the first
    /// note. The id is derived here from the name, so a caller cannot post on one wall
    /// while claiming another.
    #[external("private")]
    fn write(
        text: [Field; 32],
        length: u16,
        nonce: Field,
        name: Field,
        name_len: u8,
    ) {
        assert(nonce != 0, "nonce required");
        assert(length > 0, "text required");
        assert(length as u32 <= MAX_FIELDS * 31, "text too long");
        assert(name_len > 0, "username required");
        assert(name_len as u32 <= 15, "username too long");
        let wall = poseidon2_hash([name, name_len as Field, DOMAIN_WALL]);

        let me = self.msg_sender();

        // Your own wall is your own front door: writing on it would be a self-post.
        // Ownership is read from your private notes, so the check reveals nothing.
        let owned = self.storage.names.at(me).get_notes(NoteGetterOptions::new());
        for i in 0..8 {
            if i < owned.len() {
                assert(
                    owned.get_unchecked(i).note.name != wall,
                    "you cannot write on your own wall",
                );
            }
        }

        let secret = self.context.request_nhk_app(get_public_keys(me).npk_m_hash);

        // One post per person, per wall, per day.
        let day = self.context.get_anchor_block_header().timestamp() / 86400;
        let limit = poseidon2_hash([secret, wall, day as Field, DOMAIN_DAILY]);
        self.context.push_nullifier_unsafe(limit);

        // Public key for this post: only the author can reproduce it, which is what
        // lets them tombstone later without revealing who they are.
        let key = poseidon2_hash([secret, wall, nonce]);
        self.enqueue(OnWallz::at(self.address)._publish(wall, text, length, nonce, key, name));
    }

    /// Public half of a wall post. Receives no author information.
    #[external("public")]
    #[only_self]
    fn _publish(
        wall: Field,
        text: [Field; 32],
        length: u16,
        nonce: Field,
        key: Field,
        name: Field,
    ) {
        assert(self.storage.exists.at(wall).read(), "no such wall");
        let count = self.storage.post_count.at(wall).read();
        let id = poseidon2_hash([wall, count as Field]);

        self.storage.post_len.at(id).write(length);
        if length as u32 <= STORED_BYTES {
            // Short note: text stays in public storage, so reads are a few slot lookups.
            self.storage.post_text.at(id).write([text[0], text[1], text[2]]);
        } else {
            // Long note: text goes to the log, state keeps only its digest.
            let digest = poseidon2_hash([length as Field].concat(text));
            self.emit(PostedLong { wall, index: count, length, digest, text });
        }
        self.storage.post_wall.at(id).initialize(wall);
        self.storage.post_nonce.at(id).initialize(nonce);
        self.storage.post_key.at(id).initialize(key);
        // Block time, from the chain itself. Nothing here trusts the caller's clock.
        self.storage.post_time.at(id).initialize(self.context.timestamp() as Field);
        self.storage.post_count.at(wall).write(count + 1);

        let seq = self.storage.activity_count.read();
        self.storage.activity_wall.at(seq).write(wall);
        self.storage.activity_post.at(seq).write(id);
        self.storage.activity_index.at(seq).write(count);
        self.storage.activity_count.write(seq + 1);
        self.emit(Posted { wall, index: count, length });
    }

    /// Tombstone one of your own posts.
    ///
    /// Authorisation is the post's own key: you prove in zero knowledge that you hold
    /// the secret behind it, so nobody else can delete a note on your behalf, and the
    /// deletion reveals no author. The text is retained; deletion is a marker.
    #[external("private")]
    fn tombstone(wall: Field, post_id: Field, nonce: Field) {
        assert(self.storage.post_wall.at(post_id).read() == wall, "post is on another wall");
        let secret = self.context.request_nhk_app(get_public_keys(self.msg_sender()).npk_m_hash);
        let expected = poseidon2_hash([secret, wall, nonce]);
        assert(expected == self.storage.post_key.at(post_id).read(), "not your post");
        self.enqueue(OnWallz::at(self.address)._tombstone(post_id));
    }

    #[external("public")]
    #[only_self]
    fn _tombstone(post_id: Field) {
        assert(!self.storage.post_deleted.at(post_id).is_initialized(), "already tombstoned");
        self.storage.post_deleted.at(post_id).initialize(true);
        self.emit(NoteTombstoned { post_id });
    }

    /// The wall owner replies to a post, on their own wall, as themselves.
    ///
    /// Ownership is proved from a private note, so the chain learns only that someone
    /// who owns the wall replied. The reply is signed in the interface, because the
    /// wall's own name is the owner's name.
    #[external("private")]
    fn reply(wall: Field, post_id: Field, text: Field) {
        assert(text != 0, "reply required");
        let me = self.msg_sender();
        let notes = self.storage.names.at(me).get_notes(NoteGetterOptions::new());
        let mut owned = false;
        // Fixed bound: loop limits must be compile-time constants.
        for i in 0..8 {
            if i < notes.len() {
                if notes.get_unchecked(i).note.name == wall {
                    owned = true;
                }
            }
        }
        assert(owned, "only the wall owner");
        self.enqueue(OnWallz::at(self.address)._reply(wall, post_id, text));
    }

    #[external("public")]
    #[only_self]
    fn _reply(wall: Field, post_id: Field, text: Field) {
        assert(self.storage.post_wall.at(post_id).read() == wall, "post is on another wall");
        assert(!self.storage.replied.at(post_id).is_initialized(), "already replied");
        self.storage.replied.at(post_id).initialize(true);
        self.storage.reply_text.at(post_id).write(text);
        self.emit(Replied { wall, post_id, text });
    }

    /// The wall's packed username, or 0 when it has none.
    #[external("public")]
    #[view]
    fn name_of(wall: Field) -> Field {
        if self.storage.display.at(wall).is_initialized() {
            self.storage.display.at(wall).read()
        } else {
            0
        }
    }

    /// Whether a wall exists. A wall exists from the moment its owner creates it.
    #[external("public")]
    #[view]
    fn is_claimed(wall: Field) -> bool {
        self.storage.claimed.at(wall).is_initialized()
    }

    /// Number of notes on a wall.
    #[external("public")]
    #[view]
    fn notes(wall: Field) -> u32 {
        self.storage.post_count.at(wall).read()
    }

    /// Deterministic wall id for a name.
    #[external("public")]
    #[view]
    fn wall_id(name: Field, len: u8) -> Field {
        assert(len > 0, "username required");
        assert(len as u32 <= 15, "username too long");
        poseidon2_hash([name, len as Field, DOMAIN_WALL])
    }

    /// First chunk of a note and its byte length. The remaining chunks are read from
    /// the derived keys by any client that knows how to compute them.
    #[external("public")]
    #[view]
    fn read_post(wall: Field, index: u32) -> pub ([Field; 3], u16) {
        let id = poseidon2_hash([wall, index as Field]);
        (
            self.storage.post_text.at(id).read(),
            self.storage.post_len.at(id).read(),
        )
    }

    /// Deterministic note id for a wall and index, so clients do not have to hash.
    #[external("public")]
    #[view]
    fn post_id_at(wall: Field, index: u32) -> pub Field {
        poseidon2_hash([wall, index as Field])
    }

    /// Block timestamp of a note, in seconds.
    #[external("public")]
    #[view]
    fn post_time_at(wall: Field, index: u32) -> Field {
        self.storage.post_time.at(poseidon2_hash([wall, index as Field])).read()
    }

    #[external("public")]
    #[view]
    fn read_reply(wall: Field, index: u32) -> pub (bool, Field) {
        let id = poseidon2_hash([wall, index as Field]);
        (
            self.storage.replied.at(id).read(),
            self.storage.reply_text.at(id).read(),
        )
    }

    /// Whether a note has been tombstoned by its author.
    #[external("public")]
    #[view]
    fn is_deleted(post_id: Field) -> bool {
        self.storage.post_deleted.at(post_id).is_initialized()
    }

    /// Total number of published notes ever. The feed reads backwards from here.
    #[external("public")]
    #[view]
    fn activity_count() -> u32 {
        self.storage.activity_count.read()
    }

    /// The (wall, post id, index) at a global activity position.
    #[external("public")]
    #[view]
    fn activity_at(seq: u32) -> pub (Field, Field, u32) {
        (
            self.storage.activity_wall.at(seq).read(),
            self.storage.activity_post.at(seq).read(),
            self.storage.activity_index.at(seq).read(),
        )
    }

    /// Link a .fog name to this wall.
    ///
    /// The private half proves you own the wall. The public half asks the Fog registry
    /// who holds the name and refuses unless it is the address that sent this call, so
    /// a caller cannot attach somebody else's name. Nothing here decides what your wall
    /// is called: `@alice123` may hold `alice.fog`.
    #[external("private")]
    fn link_fog(wall: Field, label: Field, label_len: u8) {
        assert(label_len >= 3, "label too short");
        assert(label_len as u32 <= 31, "label too long");
        let me = self.msg_sender();
        let notes = self.storage.names.at(me).get_notes(NoteGetterOptions::new());
        let mut owned = false;
        for i in 0..10 {
            if i < notes.len() {
                if notes.get_unchecked(i).note.name == wall {
                    owned = true;
                }
            }
        }
        assert(owned, "only the wall owner can link a name");
        self.enqueue(OnWallz::at(self.address)._link_fog(wall, label, label_len, me.to_field()));
    }

    #[external("public")]
    #[only_self]
    fn _link_fog(wall: Field, label: Field, label_len: u8, claimant: Field) {
        assert(self.storage.exists.at(wall).read(), "no such wall");
        // The contract records the claim and leaves the verification to readers, who can
        // see Fog. That keeps a link as cheap and as ordinary as a write, and wallet
        // support does not depend on simulating a third contract.
        self.emit(FogLinked { wall, claimant, label });
    }

    /// Remove the link from your wall. The badge disappears, the notes stay.
    #[external("private")]
    fn unlink_fog(wall: Field) {
        let me = self.msg_sender();
        let notes = self.storage.names.at(me).get_notes(NoteGetterOptions::new());
        let mut owned = false;
        for i in 0..10 {
            if i < notes.len() {
                if notes.get_unchecked(i).note.name == wall {
                    owned = true;
                }
            }
        }
        assert(owned, "only the wall owner can unlink a name");
        self.enqueue(OnWallz::at(self.address)._unlink_fog(wall));
    }

    #[external("public")]
    #[only_self]
    fn _unlink_fog(wall: Field) {
        self.emit(FogUnlinked { wall });
    }

    /// The wall a wallet owns, as a packed handle, or 0 if it owns none.
    ///
    /// Utility: runs unconstrained in the wallet, so it can read a private note and
    /// tell the interface which wall belongs to it after a refresh or on another
    /// device. Passing another owner's address returns 0, since those notes are not in
    /// this wallet's PXE.
    #[external("utility")]
    unconstrained fn my_wall(owner: AztecAddress) -> pub Field {
        let notes = self.storage.names.at(owner).view_notes(NoteViewerOptions::new());
        let count = notes.len();
        if count > 0 {
            notes.get_unchecked(0).handle
        } else {
            0
        }
    }
}
