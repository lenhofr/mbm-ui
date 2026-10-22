import Foundation

// Tag clean-up for the Home filter chips and `tag:` search (src/lib/tags.ts). Recipes keep
// the tags they were saved with; an alias only adds its main tag, so a "slow cooker" recipe
// also counts as "crockpot" and a "vegan" one as "vegetarian". The lists are generated from
// tags.ts: change them there first. TagsTests checks this against the web.
enum Tags {
    /// Other spellings and narrower words → the tag they also count as (TAG_ALIASES).
    static let aliases: [String: String] = [
        "slow cooker": "crockpot",
        "slow-cooker": "crockpot",
        "crock pot": "crockpot",
        "crock-pot": "crockpot",
        "easy": "quick & easy",
        "quick": "quick & easy",
        "weeknight dinner": "dinner",
        "appetizers": "appetizer",
        "finger food": "appetizer",
        "desserts": "dessert",
        "vegan": "vegetarian",
        "keto": "low carb",
        "low-carb": "low carb",
    ]

    /// The Home chip row, in this order: a fixed list (not "most used") so each chip always
    /// means the same thing. A chip only shows when some recipe has it (CHIP_TAGS).
    static let chips: [String] = ["dinner", "chicken", "crockpot", "quick & easy", "pasta", "vegetarian", "appetizer", "dessert"]

    /// The chips to show for these recipes ("all" is added by the screen) (chipTags).
    static func chips(for recipes: [Recipe]) -> [String] {
        let present = Set(recipes.flatMap(\.allTags))
        return chips.filter(present.contains)
    }
}

extension Recipe {
    /// Tags lowercased, plus the main tag of any alias among them (recipeTags in tags.ts).
    var allTags: [String] {
        var out: [String] = []
        for raw in tags ?? [] {
            let tag = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            for t in [tag, Tags.aliases[tag]].compactMap({ $0 }) where !t.isEmpty && !out.contains(t) {
                out.append(t)
            }
        }
        return out
    }
}
