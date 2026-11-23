use aztec::protocol::address::AztecAddress;
use aztec::test::helpers::test_environment::TestEnvironment;
use onwallz_contract::OnWallz;

global PACKED_HARISH: Field = 184424648671776712915072915417628952194365578892730051071736168824505892864;

unconstrained fn setup() -> (
    TestEnvironment,
    AztecAddress,
    AztecAddress,
    AztecAddress,
) {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let alice = env.create_light_account();
    let bob = env.create_light_account();
    let address = env
        .deploy("@onwallz_contract/OnWallz")
        .with_private_initializer(deployer, OnWallz::interface().constructor());
    (env, alice, bob, address)
}

fn name_of_harish() -> (Field, u8) {
    (0x686172697368, 6) // "harish"
}

#[test]
unconstrained fn test_create_makes_an_empty_wall() {
    let (mut env, alice, _bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));

    env.call_private(alice, OnWallz::at(address).create(n, len));

    assert(env.view_public(OnWallz::at(address).is_claimed(wall)), "created");
    assert(env.view_public(OnWallz::at(address).notes(wall)) == 0, "empty at first");
    assert(env.view_public(OnWallz::at(address).name_of(wall)) == n, "name recorded");
}

#[test(should_fail)]
unconstrained fn test_a_name_can_only_be_created_once() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(bob, OnWallz::at(address).create(n, len));
}

#[test(should_fail)]
unconstrained fn test_cannot_write_on_a_wall_that_does_not_exist() {
    let (mut env, _alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    env.call_private(bob, OnWallz::at(address).write([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 11, n, len));
}

#[test(should_fail)]
unconstrained fn test_owner_cannot_write_on_their_own_wall() {
    let (mut env, alice, _bob, address) = setup();
    let (n, len) = name_of_harish();
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(alice, OnWallz::at(address).write([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 12, n, len));
}

#[test]
unconstrained fn test_a_stranger_writes_anonymously() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));

    env.call_private(bob, OnWallz::at(address).write([7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 21, n, len));

    assert(env.view_public(OnWallz::at(address).notes(wall)) == 1);
    let (text, length) = env.view_public(OnWallz::at(address).read_post(wall, 0));
    assert(text[0] == 7);
    assert(length == 1);
    // the note carries no identity: no view anywhere maps it to an address
    assert(env.view_public(OnWallz::at(address).name_of(wall)) == n, "only the wall's name is public");
}

#[test]
unconstrained fn test_a_note_records_block_time() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(bob, OnWallz::at(address).write([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 31, n, len));

    let when = env.view_public(OnWallz::at(address).post_time_at(wall, 0));
    assert(when != 0, "the chain stamped the note");
}

#[test]
unconstrained fn test_owner_replies_on_their_wall() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(bob, OnWallz::at(address).write([9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 41, n, len));

    let post_id = env.view_public(OnWallz::at(address).post_id_at(wall, 0));
    env.call_private(alice, OnWallz::at(address).reply(wall, post_id, 555));

    let (replied, text) = env.view_public(OnWallz::at(address).read_reply(wall, 0));
    assert(replied);
    assert(text == 555);
}

#[test(should_fail)]
unconstrained fn test_stranger_cannot_reply_as_the_owner() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(bob, OnWallz::at(address).write([9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 51, n, len));

    let post_id = env.view_public(OnWallz::at(address).post_id_at(wall, 0));
    env.call_private(bob, OnWallz::at(address).reply(wall, post_id, 1));
}

#[test]
unconstrained fn test_author_can_tombstone_and_text_is_kept() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(bob, OnWallz::at(address).write([3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3, 61, n, len));

    let post_id = env.view_public(OnWallz::at(address).post_id_at(wall, 0));
    env.call_private(bob, OnWallz::at(address).tombstone(wall, post_id, 61));
    assert(env.view_public(OnWallz::at(address).is_deleted(post_id)));

    let (text, l) = env.view_public(OnWallz::at(address).read_post(wall, 0));
    assert(text[0] == 3);
    assert(l == 3);
}

#[test(should_fail)]
unconstrained fn test_a_stranger_cannot_tombstone_someone_elses_note() {
    let (mut env, alice, bob, address) = setup();
    let carol = env.create_light_account();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(bob, OnWallz::at(address).write([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 71, n, len));

    let post_id = env.view_public(OnWallz::at(address).post_id_at(wall, 0));
    env.call_private(carol, OnWallz::at(address).tombstone(wall, post_id, 71));
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
    env.call_private(bob, OnWallz::at(address).create(n1, l1));
    env.call_private(carol, OnWallz::at(address).create(n2, l2));
    assert(env.view_public(OnWallz::at(address).activity_count()) == 0);

    let dave = env.create_light_account();
    env.call_private(dave, OnWallz::at(address).write([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 81, n1, l1));
    env.call_private(dave, OnWallz::at(address).write([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 82, n2, l2));

    assert(env.view_public(OnWallz::at(address).activity_count()) == 2);
    let first = env.view_public(OnWallz::at(address).activity_at(0));
    let second = env.view_public(OnWallz::at(address).activity_at(1));
    assert(first.0 == w1);
    assert(second.0 == w2);
}

#[test]
unconstrained fn test_a_long_note_keeps_its_text_out_of_public_storage() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));

    // 200 bytes: above the 93-byte storage threshold, below the 992 cap
    let mut text = [0; 32];
    text[0] = 0x4141414141414141;
    env.call_private(bob, OnWallz::at(address).write(text, 200, 91, n, len));

    assert(env.view_public(OnWallz::at(address).notes(wall)) == 1);
    let (stored, length) = env.view_public(OnWallz::at(address).read_post(wall, 0));
    assert(length == 200, "length recorded");
    assert(stored[0] == 0, "text is not in public storage");
}

#[test]
unconstrained fn test_a_short_note_still_keeps_its_text_in_storage() {
    let (mut env, alice, bob, address) = setup();
    let (n, len) = name_of_harish();
    let wall = env.view_public(OnWallz::at(address).wall_id(n, len));
    env.call_private(alice, OnWallz::at(address).create(n, len));
    env.call_private(bob, OnWallz::at(address).write([7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1, 92, n, len));
    let (stored, length) = env.view_public(OnWallz::at(address).read_post(wall, 0));
    assert(length == 1);
    assert(stored[0] == 7, "short text stays readable from storage");
}

#[test]
unconstrained fn test_owner_links_a_fog_name() {
    let (mut env, alice, _bob, address) = setup();
    env.call_private(alice, OnWallz::at(address).create(PACKED_HARISH, 6));
    let wall = env.view_public(OnWallz::at(address).wall_id(PACKED_HARISH, 6));
    env.call_private(alice, OnWallz::at(address).link_fog(wall, PACKED_HARISH, 6));
    env.call_private(alice, OnWallz::at(address).unlink_fog(wall));
}

#[test(should_fail)]
unconstrained fn test_a_stranger_cannot_link_a_fog_name() {
    let (mut env, alice, bob, address) = setup();
    env.call_private(alice, OnWallz::at(address).create(PACKED_HARISH, 6));
    let wall = env.view_public(OnWallz::at(address).wall_id(PACKED_HARISH, 6));
    env.call_private(bob, OnWallz::at(address).link_fog(wall, PACKED_HARISH, 6));
}

