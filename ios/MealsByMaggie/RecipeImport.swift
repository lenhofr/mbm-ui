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

    static func extract(_ job: ImportJob, token: String, tags: (main: [String], known: [String])) async throws -> ExtractResult {
        do {
            return try await send(job, token: token, tags: tags)
        } catch ExtractError.failed {
            // Some big recipe sites block the server's page fetch; fetch the page from
            // the phone instead (sites rarely block real devices) and send its text.
            guard case .link(let url) = job.kind, let text = await PageReader.recipeText(from: url) else {
                throw ExtractError.failed
            }
            return try await send(ImportJob(kind: .text("Web page: \(url)\n\n---\n\(text)")), token: token, tags: tags)
        }
    }

    private static func send(_ job: ImportJob, token: String, tags: (main: [String], known: [String])) async throws -> ExtractResult {
        var body: [String: Any] = ["mainTags": tags.main, "knownTags": tags.known]
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

/// Downloads a recipe page on the device and boils it down to text for the AI:
/// the page's structured recipe data (schema.org JSON-LD) if it has some, else
/// its visible text (mirrors _PageParser / find_ld_recipe in ai_extract.py).
enum PageReader {
    private static let maxCharacters = 20_000

    static func recipeText(from urlString: String) async -> String? {
        guard let url = URL(string: urlString) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        let html = String(decoding: data.prefix(3_000_000), as: UTF8.self)
        let text = structuredRecipe(in: html) ?? visibleText(of: html)
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count < 80 ? nil : String(trimmed.prefix(maxCharacters))
    }

    /// Title, ingredients and steps from a schema.org Recipe in the page's JSON-LD.
    nonisolated static func structuredRecipe(in html: String) -> String? {
        let blocks = html.matches(of: /(?is)<script[^>]*application\/ld\+json[^>]*>(.*?)<\/script>/).map { String($0.output.1) }
        for block in blocks {
            guard let json = try? JSONSerialization.jsonObject(with: Data(block.utf8)),
                  let recipe = findRecipe(in: json) else { continue }
            var lines: [String] = []
            if let name = recipe["name"] as? String { lines.append(name) }
            if let description = recipe["description"] as? String { lines.append(description) }
            if let yield = recipe["recipeYield"] { lines.append("Servings: \(flatten(yield).first ?? "")") }
            if let time = recipe["totalTime"] as? String { lines.append("Total time: \(time)") }
            let ingredients = flatten(recipe["recipeIngredient"] ?? [])
            let steps = flatten(recipe["recipeInstructions"] ?? [])
            guard !ingredients.isEmpty, !steps.isEmpty else { continue }
            lines.append("\nIngredients:")
            lines += ingredients.map { "- \($0)" }
            lines.append("\nInstructions:")
            lines += steps.enumerated().map { "\($0.offset + 1). \($0.element)" }
            return lines.joined(separator: "\n")
        }
        return nil
    }

    private nonisolated static func findRecipe(in json: Any) -> [String: Any]? {
        if let object = json as? [String: Any] {
            let type = object["@type"]
            if (type as? String) == "Recipe" || (type as? [String])?.contains("Recipe") == true { return object }
            if let graph = object["@graph"] { return findRecipe(in: graph) }
        } else if let array = json as? [Any] {
            for item in array { if let found = findRecipe(in: item) { return found } }
        }
        return nil
    }

    /// Strings from JSON-LD values: plain strings, HowToStep text, HowToSection lists.
    private nonisolated static func flatten(_ value: Any) -> [String] {
        if let string = value as? String { return [decodeEntities(string)] }
        if let array = value as? [Any] { return array.flatMap(flatten) }
        if let object = value as? [String: Any] {
            if let items = object["itemListElement"] { return flatten(items) }
            if let text = object["text"] as? String { return [decodeEntities(text)] }
            if let name = object["name"] as? String { return [decodeEntities(name)] }
        }
        return []
    }

    /// Readable text with scripts, styles and tags removed.
    nonisolated static func visibleText(of html: String) -> String {
        var text = html.replacing(/(?is)<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?<\/\1>/, with: " ")
        text = text.replacing(/(?i)<(br|\/p|\/li|\/h\d|\/div)[^>]*>/, with: "\n")
        text = text.replacing(/<[^>]+>/, with: " ")
        text = decodeEntities(text)
        let lines = text.split(separator: "\n").map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
        return lines.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    private nonisolated static func decodeEntities(_ s: String) -> String {
        var out = s
        for (entity, char) in [("&amp;", "&"), ("&quot;", "\""), ("&#39;", "'"), ("&#039;", "'"), ("&apos;", "'"),
                               ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " "), ("&#8217;", "’"), ("&#8211;", "–"), ("&frac12;", "½")] {
            out = out.replacingOccurrences(of: entity, with: char)
        }
        return out
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
