import Foundation

// Quantity parsing, formatting and scaling for ingredient amounts, ported from
// src/lib/quantity.ts so "1 1/2 cups" doubles to "3 cups" the same way on web and iOS.
nonisolated enum Quantity {
    private static let unicodeFractions: [Character: Double] = [
        "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1.0 / 3, "⅔": 2.0 / 3, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
    ]
    private static let displayFractions: [(Double, String)] = [
        (0.125, "⅛"), (0.25, "¼"), (1.0 / 3, "⅓"), (0.5, "½"), (2.0 / 3, "⅔"), (0.75, "¾"),
    ]

    /// "2 1/4 cups flour" → (2.25, "cups flour"). Ranges keep the first number ("4-6" → 4).
    static func split(_ input: String) -> (quantity: Double, rest: String)? {
        let s = input.trimmingCharacters(in: .whitespaces)
        let pattern = /^(?:(\d+)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:\.\d+)?)\s*([¼½¾⅓⅔⅛⅜⅝⅞])?|([¼½¾⅓⅔⅛⅜⅝⅞]))/
        guard let m = s.firstMatch(of: pattern) else { return nil }
        let q: Double
        if let whole = m.output.1, let num = m.output.2, let den = m.output.3 {
            q = Double(whole)! + Double(num)! / Double(den)!
        } else if let num = m.output.4, let den = m.output.5 {
            q = Double(num)! / Double(den)!
        } else if let number = m.output.6 {
            q = Double(number)! + (m.output.7.flatMap { unicodeFractions[Character(String($0))] } ?? 0)
        } else if let fraction = m.output.8 {
            q = unicodeFractions[Character(String(fraction))] ?? 0
        } else {
            return nil
        }
        guard q.isFinite, q != 0 else { return nil }
        var rest = String(s[m.range.upperBound...]).trimmingCharacters(in: .whitespaces)
        // Drop the upper end of a range ("-6", "to 11") so it doesn't read as part of the unit.
        if let range = rest.firstMatch(of: /^(?i)(?:-|–|to)\s*\d+(?:\.\d+)?(?:\/\d+)?\s*/) {
            rest = String(rest[range.range.upperBound...])
        }
        return (q, rest)
    }

    /// 2.25 → "2¼", 0.333 → "⅓", 1.4 → "1.4".
    static func format(_ n: Double) -> String {
        let whole = (n + 0.01).rounded(.down)
        let remainder = n - whole
        if remainder < 0.06 { return String(Int(whole)) }
        var best = displayFractions[0]
        var distance = Double.infinity
        for fraction in displayFractions where abs(fraction.0 - remainder) < distance {
            distance = abs(fraction.0 - remainder)
            best = fraction
        }
        if distance > 0.06 {
            let rounded = (n * 10).rounded() / 10
            return rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        }
        return (whole > 0 ? String(Int(whole)) : "") + best.1
    }

    /// Scales "1 1/2 cups" by `multiplier`; amounts without a number are left alone.
    static func scale(_ amount: String?, by multiplier: Double) -> String {
        guard let amount, !amount.isEmpty else { return "" }
        guard multiplier != 1, let (q, rest) = split(amount) else { return amount }
        return [format(q * multiplier), rest].filter { !$0.isEmpty }.joined(separator: " ")
    }
}

extension Recipe.Ingredient {
    /// Ingredient line with its amount scaled for a different number of servings.
    func displayText(scaledBy multiplier: Double) -> String {
        [Quantity.scale(amount, by: multiplier), name].filter { !$0.isEmpty }.joined(separator: " ")
    }
}
