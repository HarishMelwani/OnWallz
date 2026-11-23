use aztec::macros::aztec;

/// The only part of the Fog Names registry (v8, Aztec testnet) OnWallz needs: who holds a
/// name, and until when. Interface-only, the same pattern aztec-nr uses for FeeJuice.
#[aztec]
pub contract FogRegistry {
    use aztec::{macros::functions::{external, view}, protocol::{address::AztecAddress, traits::{Deserialize, FromField, Serialize}}};

    #[derive(Eq, Serialize, Deserialize)]
    pub struct NameRecord {
        pub generation: u32,
        pub owner: AztecAddress,
        pub revision: u32,
        pub expires_at: u64,
    }

    #[external("public")]
    #[view]
    fn get_name(node: Field) -> pub NameRecord {
        NameRecord {
            generation: 0,
            owner: AztecAddress::from_field(0),
            revision: 0,
            expires_at: 0,
        }
    }
}
