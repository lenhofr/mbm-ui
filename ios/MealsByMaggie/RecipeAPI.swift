import Foundation

// Swift counterpart of RemoteAdapter in mbm-ui (src/lib/storage.ts).
// Only reads for now; GET routes don't require a Cognito token.
enum RecipeAPI {
    static let baseURL = "https://y41n44j885.execute-api.us-east-1.amazonaws.com"

    enum APIError: LocalizedError {
        case badStatus(Int)

        var errorDescription: String? {
            switch self {
            case .badStatus(let code): "The kitchen is closed right now (HTTP \(code))."
            }
        }
    }

    static func listRecipes() async throws -> [Recipe] {
        let url = URL(string: "\(baseURL)/recipes")!
        let (data, response) = try await URLSession.shared.data(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
        return try JSONDecoder().decode([Recipe].self, from: data)
    }
}
