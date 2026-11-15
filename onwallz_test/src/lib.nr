use aztec::test::helpers::test_environment::TestEnvironment;
use onwallz_contract::OnWallz;

unconstrained fn setup() -> (TestEnvironment, aztec::protocol::address::AztecAddress, aztec::protocol::address::AztecAddress, aztec::protocol::address::AztecAddress) {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let alice = env.create_light_account();
    let bob = env.create_light_account();
    let address = env
        .deploy("@onwallz_contract/OnWallz")
        .with_private_initializer(deployer, OnWallz::interface().constructor());
    (env, alice, bob, address)
}

#[test]
unconstrained fn test_write_creates_wall_and_is_anonymous() {
    let (mut env, _alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    assert(env.view_public(OnWallz::at(address).notes(wall)) == 0);

    env.call_private(bob, OnWallz::at(address).write(wall, [7, 0, 0], 1, 11, 0, 0, n, len));

    assert(env.view_public(OnWallz::at(address).notes(wall)) == 1, "first note creates the wall");
    assert(!env.view_public(OnWallz::at(address).is_claimed(wall)), "writing does not claim");
    let (text, length, mode, tag) = env.view_public(OnWallz::at(address).read_post(wall, 0));
    assert(text[0] == 7);
    assert(length == 1);
    assert(mode == 0, "anonymous by default");
    assert(tag == 0, "no tag when anonymous");
}

#[test]
unconstrained fn test_name_is_recorded_without_an_owner_address() {
    let (mut env, alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [1, 1, 1], 3, 21, 0, 0, n, len));
    env.call_private(alice, OnWallz::at(address).claim(n, len, [21, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));

    assert(env.view_public(OnWallz::at(address).is_claimed(wall)), "claimed");
    // page() exposes the name and the note count - and nothing else: there is no
    // view anywhere that maps a wall to an address.
    let (display, count) = env.view_public(OnWallz::at(address).page(wall));
    assert(display == n, "display is the packed username");
    assert(count == 1);
}

#[test(should_fail)]
unconstrained fn test_cannot_claim_a_wall_nobody_wrote_on() {
    let (mut env, alice, _bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    env.call_private(alice, OnWallz::at(address).claim(n, len, [21, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));
}

#[test(should_fail)]
unconstrained fn test_a_name_can_only_be_claimed_once() {
    let (mut env, alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [1, 0, 0], 1, 31, 0, 0, n, len));
    env.call_private(alice, OnWallz::at(address).claim(n, len, [31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));
    // the claim nullifier is spent, so even the same wallet cannot repeat it
    env.call_private(alice, OnWallz::at(address).claim(n, len, [31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));
}

#[test]
unconstrained fn test_owner_reply_is_proved_from_a_private_note() {
    let (mut env, alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [9, 0, 0], 1, 41, 0, 0, n, len));
    env.call_private(alice, OnWallz::at(address).claim(n, len, [41, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));

    let post_id = env.view_public(OnWallz::at(address).post_id_at(wall, 0));
    env.call_private(alice, OnWallz::at(address).reply(wall, post_id, 555));

    let (replied, text) = env.view_public(OnWallz::at(address).read_reply(wall, 0));
    assert(replied);
    assert(text == 555);
}

#[test(should_fail)]
unconstrained fn test_stranger_cannot_reply_as_the_owner() {
    let (mut env, alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [9, 0, 0], 1, 51, 0, 0, n, len));
    env.call_private(alice, OnWallz::at(address).claim(n, len, [51, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));
    let post_id = env.view_public(OnWallz::at(address).post_id_at(wall, 0));
    // bob has no ownership note for this wall
    env.call_private(bob, OnWallz::at(address).reply(wall, post_id, 1));
}

#[test]
unconstrained fn test_author_can_tombstone_and_content_is_kept() {
    let (mut env, _alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [3, 2, 1], 3, 61, 0, 0, n, len));
    let post_id = env.view_public(OnWallz::at(address).post_id_at(wall, 0));
    env.call_private(bob, OnWallz::at(address).tombstone(wall, post_id, 61));
    assert(env.view_public(OnWallz::at(address).is_deleted(post_id)));
    let (text, l, _, _) = env.view_public(OnWallz::at(address).read_post(wall, 0));
    assert(text[0] == 3);
    assert(l == 3);
}

#[test]
unconstrained fn test_activity_log_orders_walls() {
    let (mut env, _alice, bob, address) = setup();
    let carol = env.create_light_account();
    let n1: Field = 0x6f6e65; // "one"
    let l1: u8 = 3;
    let n2: Field = 0x74776f; // "two"
    let l2: u8 = 3;
    let w1 = env.view_public(OnWallz::at(address).wall_id(n1, l1));
    let w2 = env.view_public(OnWallz::at(address).wall_id(n2, l2));
    assert(env.view_public(OnWallz::at(address).activity_count()) == 0);
    env.call_private(bob, OnWallz::at(address).write(w1, [1, 0, 0], 1, 71, 0, 0, n1, l1));
    env.call_private(carol, OnWallz::at(address).write(w2, [2, 0, 0], 1, 72, 0, 0, n2, l2));
    assert(env.view_public(OnWallz::at(address).activity_count()) == 2);
    let first = env.view_public(OnWallz::at(address).activity_at(0));
    let second = env.view_public(OnWallz::at(address).activity_at(1));
    assert(first.0 == w1);
    assert(second.0 == w2);
}

#[test(should_fail)]
unconstrained fn test_owner_cannot_write_on_their_own_wall() {
    let (mut env, alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [1, 0, 0], 1, 81, 0, 0, n, len));
    env.call_private(alice, OnWallz::at(address).claim(n, len, [81, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));
    // alice owns the wall now, so her own write must be refused
    env.call_private(alice, OnWallz::at(address).write(wall, [2, 0, 0], 1, 82, 0, 0, n, len));
}

#[test]
unconstrained fn test_a_stranger_can_still_write_after_the_wall_is_claimed() {
    let (mut env, alice, bob, address) = setup();
    let carol = env.create_light_account();
    let n: Field = 0x686172697368;
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [1, 0, 0], 1, 91, 0, 0, n, len));
    env.call_private(alice, OnWallz::at(address).claim(n, len, [91, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1));
    env.call_private(carol, OnWallz::at(address).write(wall, [3, 0, 0], 1, 92, 0, 0, n, len));
    assert(env.view_public(OnWallz::at(address).notes(wall)) == 2);
}

#[test(should_fail)]
unconstrained fn test_cannot_claim_a_wall_you_wrote_on() {
    let (mut env, alice, _bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    // alice writes first, then tries to claim the very wall she wrote on
    env.call_private(alice, OnWallz::at(address).write(wall, [1, 0, 0], 1, 101, 0, 0, n, len));
    let nonces = [101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    env.call_private(alice, OnWallz::at(address).claim(n, len, nonces, 1));
}

#[test]
unconstrained fn test_claim_works_when_someone_else_wrote() {
    let (mut env, alice, bob, address) = setup();
    let n: Field = 0x686172697368; // "harish"
    let len: u8 = 6;
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(bob, OnWallz::at(address).write(wall, [1, 0, 0], 1, 111, 0, 0, n, len));
    let nonces = [111, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    env.call_private(alice, OnWallz::at(address).claim(n, len, nonces, 1));
    assert(env.view_public(OnWallz::at(address).is_claimed(wall)));
}



#[test(should_fail)]
unconstrained fn test_cannot_label_a_wall_it_is_not() {
    let (mut env, alice, bob, address) = setup();
    let alice_name: Field = 0x616c696365; // "alice"
    let bob_name: Field = 0x626f62;       // "bob"
    // the id of alice's wall, but labelled as bob and with bob's length
    let alice_wall = env.view_public(OnWallz::at(address).wall_id(alice_name, 5));
    env.call_private(bob, OnWallz::at(address).write(alice_wall, [1, 0, 0], 1, 9001, 0, 0, bob_name, 3));
}
