import Foundation

// Mirrors the Recipe type in mbm-ui (src/types.ts). Every field except id and
// title is optional because older records in DynamoDB don't always have them.
struct Recipe: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var description: String?
    var image: String?
    var tags: [String]?
    var ingredients: [Ingredient]?
    var servings: String?
    var cookTime: String?
    var instructions: [String]?
    var createdByName: String?
    var updatedByName: String?
    var createdAt: Double?
    var updatedAt: Double?

    struct Ingredient: Codable, Hashable {
        var name: String
        var amount: String?
    }

    /// Displayable image URL. Stored values are usually S3 keys like
    /// "uploads/abc.jpeg", which the API redirects to a signed S3 URL.
    var imageURL: URL? {
        guard let image, !image.isEmpty else { return nil }
        if image.hasPrefix("http") { return URL(string: image) }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let encoded = image.addingPercentEncoding(withAllowedCharacters: allowed) ?? image
        return URL(string: "\(RecipeAPI.baseURL)/images/\(encoded)")
    }
}
