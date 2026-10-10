import Foundation

// Per-user favorite recipe IDs, stored on the device and keyed by the Cognito
// user ID, like src/lib/favorites.ts (the API doesn't store favorites yet).
@Observable
final class Favorites {
    private(set) var ids: Set<String> = []
    private var key = Favorites.key(for: nil)

    func contains(_ id: String) -> Bool { ids.contains(id) }

    /// Switch to the favorites of the signed-in user (or the signed-out list).
    func load(for userSub: String?) {
        key = Self.key(for: userSub)
        ids = Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    }

    func toggle(_ id: String) {
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
        UserDefaults.standard.set(Array(ids), forKey: key)
    }

    private static func key(for userSub: String?) -> String {
        "mbm:favorites:\(userSub ?? "anon")"
    }
}
