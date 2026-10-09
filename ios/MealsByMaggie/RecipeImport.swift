import UIKit

/// Something to turn into a recipe with AI (ImportJob in src/state/AppContext.tsx).
struct ImportJob: Identifiable {
    enum Kind {
        case scan([UIImage])
        case screenshot(UIImage)
        case link(String)
        case text(String)
    }

    let id = UUID()
    var kind: Kind

    var source: RecipeDraft.Source {
        switch kind {
        case .scan: .scan
        case .screenshot: .screenshot
        case .link: .link
        case .text: .text
        }
    }

    /// "allrecipes.com" for links (hostOf in src/lib/extract.ts).
    var host: String? {
        guard case .link(let url) = kind else { return nil }
        return Self.host(of: url)
    }

    static func host(of url: String) -> String {
        guard let host = URL(string: url)?.host() else { return url }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// Work out whether pasted text is a link or recipe text (detectPaste in extract.ts).
    static func detect(_ value: String) -> Kind? {
        let s = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if s.wholeMatch(of: /(?i)https?:\/\/\S+/) != nil, URL(string: s)?.host() != nil {
            return .link(s)
        }
        return .text(s)
    }
}

/// Response of POST /ai/extract-recipe (ExtractResult in src/lib/draft.ts).
struct ExtractResult: Decodable {
    struct Entry: Decodable {
        var text: String?
        var name: String?
        var amount: String?
        var flag: FlagDTO?
    }

    struct FlagDTO: Decodable {
        var q: String
        var opts: [[String]]
    }

    var readable: Bool?
    var title: String?
    var description: String?
    var cookTime: String?
    var tags: [String]?
    var ingredients: [Entry]?
    var instructions: [Entry]?
    var servings: Int?
    var error: String?
}

// Client for the AI recipe extraction endpoint (src/lib/extract.ts).
enum ExtractAPI {
    enum ExtractError: Error {
        /// The model couldn't find or read a recipe.
        case unreadable
        case failed
    }

    static func extract(_ job: ImportJob, token: String, knownTags: [String]) async throws -> ExtractResult {
        var body: [String: Any] = ["knownTags": Array(knownTags.prefix(30))]
        switch job.kind {
        case .link(let url):
            body["type"] = "url"
            body["url"] = url
        case .text(let text):
            body["type"] = "text"
            body["text"] = text
        case .scan(let pages):
            body["type"] = "image"
            body["source"] = "scan"
            body["images"] = pages.prefix(4).compactMap(encodedImage)
        case .screenshot(let image):
            body["type"] = "image"
            body["source"] = "screenshot"
            body["images"] = [encodedImage(image)].compactMap { $0 }
        }

        var request = URLRequest(url: URL(string: "\(RecipeAPI.baseURL)/ai/extract-recipe")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let result = try? JSONDecoder().decode(ExtractResult.self, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let result else {
            throw ExtractError.failed
        }
        if result.readable == false { throw ExtractError.unreadable }
        if result.error != nil { throw ExtractError.failed }
        return result
    }

    /// Base64 JPEG for the model: longest side 1568px, stepping quality down to stay
    /// under 1.5MB per page so several pages fit in one request (compressForExtract).
    private static func encodedImage(_ image: UIImage) -> [String: String]? {
        let maxDimension: CGFloat = 1568
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let target = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        for quality in [0.85, 0.75, 0.6, 0.45] {
            if let data = resized.jpegData(compressionQuality: quality), data.count <= 1_500_000 {
                return ["data": data.base64EncodedString(), "mediaType": "image/jpeg"]
            }
        }
        return nil
    }
}

extension RecipeDraft {
    /// Editor draft from an AI result, keeping the "not sure" flags (draftFromExtract).
    init(extract result: ExtractResult, job: ImportJob) {
        self.init()
        source = job.source
        sourceLabel = job.host
        if case .scan(let pages) = job.kind { originals = pages }
        title = result.title ?? ""
        description = result.description ?? ""
        cookTime = result.cookTime ?? ""
        if let n = result.servings, n > 0 { servings = n }

        var seen = Set<String>()
        tags = (result.tags ?? []).map(Self.normalizeTag).filter { !$0.isEmpty && seen.insert($0).inserted }
        aiTags = Set(tags)

        ingredients = (result.ingredients ?? []).map { entry in
            let text = entry.text ?? [entry.amount, entry.name].compactMap { $0 }.joined(separator: " ")
            return Row(text: text, flag: Self.flag(entry.flag, text: text))
        }
        steps = (result.instructions ?? []).map { entry in
            Row(text: entry.text ?? "", flag: Self.flag(entry.flag, text: entry.text ?? ""))
        }
        if ingredients.isEmpty { ingredients = [Row(text: "")] }
        if steps.isEmpty { steps = [Row(text: "")] }
        initialFlagCount = (ingredients + steps).filter { $0.flag != nil }.count
    }

    private static func flag(_ dto: ExtractResult.FlagDTO?, text: String) -> Flag? {
        guard let dto else { return nil }
        let options = dto.opts.compactMap { pair in
            pair.count == 2 ? Flag.Option(text: pair[0], label: pair[1]) : nil
        }
        return options.count >= 2 ? Flag(question: dto.q, options: options) : nil
    }
}
