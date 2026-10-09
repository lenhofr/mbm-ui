import UIKit

/// Editor state for a new or existing recipe (Draft in src/types.ts, conversions
/// from src/lib/draft.ts). Ingredients and steps are edited as plain text lines.
struct RecipeDraft {
    /// Where the draft came from; AI sources get a review banner in the editor.
    enum Source { case manual, edit, scan, link, text, screenshot }

    /// A question the AI asks about a word it wasn't sure of, with full-text choices.
    struct Flag: Equatable {
        struct Option: Equatable { var text: String; var label: String }
        var question: String
        var options: [Option]
    }

    struct Row: Identifiable, Equatable {
        let id = UUID()
        var text: String
        var flag: Flag? = nil
        /// The user confirmed or edited a flagged row.
        var ok = false

        var needsReview: Bool { flag != nil && !ok }
    }

    static let defaultServings = 4

    var source: Source = .manual
    /// Site name for link imports ("allrecipes.com").
    var sourceLabel: String?
    /// The scanned pages, for the "Original" viewer.
    var originals: [UIImage] = []
    /// Tags the AI suggested (shown with a dashed border until saved).
    var aiTags: Set<String> = []
    /// How many rows were flagged when the draft was created.
    var initialFlagCount = 0

    var id: String?
    var title = ""
    var description = ""
    var cookTime = ""
    var servings = defaultServings
    /// Stored image key/URL of the existing photo.
    var image: String?
    /// A newly picked photo, uploaded on save.
    var newPhoto: UIImage?
    var tags: [String] = []
    var ingredients: [Row] = [Row(text: "")]
    var steps: [Row] = [Row(text: "")]

    var isEdit: Bool { id != nil }
    var isAI: Bool { [.scan, .link, .text, .screenshot].contains(source) }
    var openFlagCount: Int { (ingredients + steps).filter(\.needsReview).count }
    var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty }

    init() {}

    init(recipe: Recipe) {
        source = .edit
        id = recipe.id
        title = recipe.title
        description = recipe.description ?? ""
        cookTime = recipe.cookTime ?? ""
        servings = Self.parseServings(recipe.servings) ?? Self.defaultServings
        image = recipe.image
        tags = recipe.tags ?? []
        ingredients = (recipe.ingredients ?? []).map { Row(text: $0.displayText) }
        steps = (recipe.instructions ?? []).map { Row(text: $0) }
        if ingredients.isEmpty { ingredients = [Row(text: "")] }
        if steps.isEmpty { steps = [Row(text: "")] }
    }

    /// The JSON body to save (recipeFromDraft); empty fields are omitted.
    func input(image: String?) -> RecipeAPI.RecipeInput {
        var seen = Set<String>()
        let cleanTags = tags.map(Self.normalizeTag).filter { !$0.isEmpty && seen.insert($0).inserted }
        let lines = ingredients.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let instructions = steps.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return RecipeAPI.RecipeInput(
            title: title.trimmingCharacters(in: .whitespaces),
            description: description.trimmingCharacters(in: .whitespaces).nilIfEmpty,
            cookTime: cookTime.trimmingCharacters(in: .whitespaces).nilIfEmpty,
            servings: String(servings),
            image: image,
            tags: cleanTags.isEmpty ? nil : cleanTags,
            ingredients: lines.isEmpty ? nil : lines.map(Self.parseIngredientLine),
            instructions: instructions.isEmpty ? nil : instructions
        )
    }

    nonisolated static func normalizeTag(_ tag: String) -> String {
        tag.trimmingCharacters(in: .whitespaces).lowercased()
    }

    /// Leading integer of a servings string ("4-6" → 4), like parseServings in quantity.ts.
    nonisolated static func parseServings(_ value: String?) -> Int? {
        guard let value, let match = value.firstMatch(of: /\d+/), let n = Int(match.output), n > 0 else { return nil }
        return n
    }

    /// "2 1/4 cups all-purpose flour" → amount "2 1/4 cups", name "all-purpose flour".
    /// Port of parseIngredientLine in src/lib/quantity.ts so saved data matches the web.
    nonisolated static func parseIngredientLine(_ line: String) -> Recipe.Ingredient {
        let s = line.trimmingCharacters(in: .whitespaces)
        let quantity = /^(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?\s*[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])/
        guard let q = s.firstMatch(of: quantity), !q.output.trimmingCharacters(in: .whitespaces).allSatisfy({ $0 == "0" || $0 == "." }) else {
            return .init(name: s)
        }
        var rest = String(s[q.range.upperBound...]).trimmingCharacters(in: .whitespaces)
        // Drop the upper end of a range ("-6", "to 11") so it doesn't read as part of the unit.
        if let range = rest.firstMatch(of: /^(?i)(?:-|–|to)\s*\d+(?:\.\d+)?(?:\/\d+)?\s*/) {
            rest = String(rest[range.range.upperBound...])
        }
        let qtyPart = String(s.dropLast(rest.count)).trimmingCharacters(in: .whitespaces)
        let units = /^(?i)(cups?|c\.|tbsps?|tbs|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|litres?|cans?|packets?|pkgs?|packages?|sticks?|cloves?|pinch(?:es)?|dash(?:es)?|quarts?|qts?|pints?|pts?|slices?|sprigs?|bunch(?:es)?|large|medium|small)\b\.?/
        // Size words ("large eggs") read better as part of the name.
        if let unit = rest.firstMatch(of: units), !["large", "medium", "small"].contains(unit.output.1.lowercased()) {
            let unitText = String(unit.output.0)
            let name = String(rest.dropFirst(unitText.count)).trimmingCharacters(in: .whitespaces)
            return .init(name: name.isEmpty ? rest : name, amount: "\(qtyPart) \(unitText)".trimmingCharacters(in: .whitespaces))
        }
        return .init(name: rest.isEmpty ? s : rest, amount: qtyPart)
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

extension UIImage {
    /// Dish photo for upload: longest side at most 1024px, JPEG (resizeDishPhoto in images.ts).
    func uploadJPEG(maxDimension: CGFloat = 1024) -> Data? {
        let scale = min(1, maxDimension / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: 0.78)
    }
}
