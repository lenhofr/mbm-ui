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

    /// Tags across all recipes, lowercased, most used first (topTags).
    static func top(in recipes: [Recipe], limit: Int = .max) -> [String] {
        var counts: [String: Int] = [:]
        for recipe in recipes {
            for tag in Set((recipe.tags ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }) {
                counts[tag, default: 0] += 1
            }
        }
        let sorted = counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
        return sorted.prefix(limit).map(\.key)
    }

    /// Tags sent to the AI importer so new recipes reuse the box's words: the chips as main
    /// tags, then the most-used others, minus alias spellings so it says "crockpot", not
    /// "slow cooker". The Lambda accepts up to 30 in all (importerTags).
    static func forImporter(_ recipes: [Recipe]) -> (main: [String], known: [String]) {
        let others = top(in: recipes).filter { aliases[$0] == nil && !chips.contains($0) }
        return (chips, Array(others.prefix(30 - chips.count)))
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
