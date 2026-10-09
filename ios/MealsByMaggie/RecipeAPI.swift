import Foundation

// Swift counterpart of RemoteAdapter in mbm-ui (src/lib/storage.ts) and
// uploadImage in src/lib/images.ts. GET routes are public; writes need the
// Cognito ID token as a Bearer token.
enum RecipeAPI {
    static let baseURL = "https://y41n44j885.execute-api.us-east-1.amazonaws.com"

    enum APIError: LocalizedError {
        case badStatus(Int)
        case notSignedIn

        var errorDescription: String? {
            switch self {
            case .badStatus(let code): "The kitchen is closed right now (HTTP \(code))."
            case .notSignedIn: "Sign in to save recipes."
            }
        }
    }

    /// Body for POST /recipes and PUT /recipes/{id}. Nil fields are left out of the JSON.
    struct RecipeInput: Encodable {
        var title: String
        var description: String?
        var cookTime: String?
        var servings: String?
        var image: String?
        var tags: [String]?
        var ingredients: [Recipe.Ingredient]?
        var instructions: [String]?
    }

    static func listRecipes() async throws -> [Recipe] {
        let (data, response) = try await URLSession.shared.data(from: url("/recipes"))
        try check(response)
        return try JSONDecoder().decode([Recipe].self, from: data)
    }

    static func createRecipe(_ input: RecipeInput, token: String) async throws -> Recipe {
        var request = authorized(url("/recipes"), method: "POST", token: token)
        request.httpBody = try JSONEncoder().encode(input)
        let (data, response) = try await URLSession.shared.data(for: request)
        try check(response)
        return try JSONDecoder().decode(Recipe.self, from: data)
    }

    static func updateRecipe(id: String, _ input: RecipeInput, token: String) async throws -> Recipe {
        var request = authorized(url("/recipes/\(encoded(id))"), method: "PUT", token: token)
        request.httpBody = try JSONEncoder().encode(input)
        let (data, response) = try await URLSession.shared.data(for: request)
        try check(response)
        return try JSONDecoder().decode(Recipe.self, from: data)
    }

    static func deleteRecipe(id: String, token: String) async throws {
        let request = authorized(url("/recipes/\(encoded(id))"), method: "DELETE", token: token)
        let (_, response) = try await URLSession.shared.data(for: request)
        try check(response)
    }

    /// Uploads a JPEG via a presigned S3 PUT and returns its stored key ("uploads/….jpeg").
    static func uploadImage(_ jpeg: Data, token: String) async throws -> String {
        struct Presign: Decodable { let uploadUrl: String; let key: String }

        var request = authorized(url("/images"), method: "POST", token: token)
        request.httpBody = try JSONEncoder().encode(["filename": "photo.jpeg", "type": "image/jpeg"])
        let (data, response) = try await URLSession.shared.data(for: request)
        try check(response)
        let presign = try JSONDecoder().decode(Presign.self, from: data)

        // These headers are part of the presigned signature, so they must match exactly.
        var upload = URLRequest(url: URL(string: presign.uploadUrl)!)
        upload.httpMethod = "PUT"
        upload.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        upload.setValue("public, max-age=31536000, immutable", forHTTPHeaderField: "Cache-Control")
        let (_, uploadResponse) = try await URLSession.shared.upload(for: upload, from: jpeg)
        try check(uploadResponse)
        return presign.key
    }

    private static func url(_ path: String) -> URL {
        URL(string: baseURL + path)!
    }

    private static func encoded(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id
    }

    private static func authorized(_ url: URL, method: String, token: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private static func check(_ response: URLResponse) throws {
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
    }
}
