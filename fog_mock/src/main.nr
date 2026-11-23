use aztec::macros::aztec;

/// A settable stand-in for the Fog registry, so tests can decide who owns a name and
/// when it expires without touching the real testnet deployment.
#[aztec]
pub contract FogMock {
    use aztec::{
        macros::{functions::{external, initializer, view}, storage::storage},
        protocol::{address::AztecAddress, traits::{Deserialize, FromField, Serialize}},
        state_vars::{Map, PublicMutable},
    };

    #[derive(Eq, Serialize, Deserialize)]
    pub struct NameRecord {
        pub generation: u32,
        pub owner: AztecAddress,
        pub revision: u32,
        pub expires_at: u64,
    }

    #[storage]
    struct Storage<Context> {
        gens: Map<Field, PublicMutable<u32, Context>, Context>,
        owners: Map<Field, PublicMutable<Field, Context>, Context>,
        expiries: Map<Field, PublicMutable<u64, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor() {}

    #[external("public")]
    fn set(node: Field, owner: Field, generation: u32, expires_at: u64) {
        self.storage.gens.at(node).write(generation);
        self.storage.owners.at(node).write(owner);
        self.storage.expiries.at(node).write(expires_at);
    }

    #[external("public")]
    #[view]
    fn get_name(node: Field) -> pub NameRecord {
        NameRecord {
            generation: self.storage.gens.at(node).read(),
            owner: AztecAddress::from_field(self.storage.owners.at(node).read()),
            revision: 0,
            expires_at: self.storage.expiries.at(node).read(),
        }
    }
}
