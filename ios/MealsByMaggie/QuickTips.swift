import SwiftUI

// Quick tips: short, bundled answers to common cooking questions (src/lib/quickTips.ts,
// QuickTips.tsx / QuickTips.css in mbm-ui). Works offline and signed out.
// The tips are generated from quickTips.ts; edit them there first, then copy them here.
// QuickTipsTests checks the search against results from the web.

struct QuickTip: Identifiable {
    enum Category: String, CaseIterable {
        // Display order of the sheet's groups (TIP_CATEGORIES).
        case eggsPoultry = "Eggs & poultry"
        case vegetables = "Vegetables"
        case meatFish = "Meat & fish"
        case tempsConversions = "Temps & conversions"
    }

    let id: String
    let category: Category
    let title: String
    var text: String?
    var rows: [(String, String)] = []
    var note: String?
    let keywords: [String]

    /// `query` is trimmed + lowercased. Matches title or keyword substrings; for queries over
    /// 3 characters, also when the query contains a keyword ("boiled eggs" → "eggs") (matchTip).
    func matches(_ query: String) -> Bool {
        if query.isEmpty { return true }
        if title.lowercased().contains(query) { return true }
        return keywords.contains { $0.contains(query) || (query.count > 3 && query.contains($0)) }
    }

    static func search(_ query: String) -> [QuickTip] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return all.filter { $0.matches(q) }
    }

    // Food-safety numbers follow the USDA FSIS chart (see quickTips.ts).
    static let all: [QuickTip] = [
        QuickTip(id: "eggs",
                 category: .eggsPoultry,
                 title: "Boiled eggs",
                 text: "Lower cold eggs into boiling water, then keep it at a gentle boil. Straight into an ice bath after.",
                 rows: [("Soft", "6 min"), ("Jammy", "7 min"), ("Hard", "10–12 min")],
                 keywords: ["egg", "eggs", "hard boiled", "soft boiled", "jammy"]),
        QuickTip(id: "poach-chicken",
                 category: .eggsPoultry,
                 title: "Boiled / poached chicken",
                 text: "Cover with cold salted water, bring to a simmer, then keep it gentle. Done at 165°F in the thickest part.",
                 rows: [("Breasts", "12–15 min"), ("Boneless thighs", "15–20 min")],
                 keywords: ["chicken", "breast", "thigh", "poach", "boil", "shredded"]),
        QuickTip(id: "roast-veg",
                 category: .vegetables,
                 title: "Roasted vegetables",
                 text: "425°F. Toss with oil and salt, spread in one layer, flip halfway.",
                 rows: [("Broccoli florets", "15–20 min"), ("Brussels sprouts, halved", "20–25 min"), ("Carrots, 1\" pieces", "25–30 min"), ("Squash, 1\" cubes", "25–35 min"), ("Potatoes, 1\" cubes", "30–40 min")],
                 keywords: ["vegetables", "veg", "carrot", "carrots", "broccoli", "brussels", "sprouts", "potato", "potatoes", "squash", "roast", "oven"]),
        QuickTip(id: "baked-potato",
                 category: .vegetables,
                 title: "Baked potatoes",
                 text: "Russets, scrubbed and poked with a fork, rubbed with oil and salt. 400°F right on the rack for 50–60 min, until a knife slides in easily.",
                 keywords: ["potato", "potatoes", "baked", "russet", "jacket"]),
        QuickTip(id: "boiled-carrots",
                 category: .vegetables,
                 title: "Boiled baby carrots",
                 text: "Into salted boiling water, then simmer until a fork slides in. Drain and toss with butter and salt.",
                 rows: [("Crisp-tender", "6–8 min"), ("Tender", "10–12 min")],
                 keywords: ["carrot", "carrots", "baby carrots", "boiled carrots"]),
        QuickTip(id: "corn",
                 category: .vegetables,
                 title: "Corn on the cob",
                 text: "Shuck, drop into a big pot of boiling water, and cover. Done when the kernels are bright and tender.",
                 rows: [("Fresh", "3–5 min"), ("Frozen cobs", "5–8 min")],
                 keywords: ["corn", "cob", "corn on the cob", "sweet corn"]),
        QuickTip(id: "fish",
                 category: .meatFish,
                 title: "Salmon & white fish",
                 text: "400°F for 12–15 min per inch of thickness. Done at 145°F, or when it flakes easily with a fork.",
                 keywords: ["fish", "salmon", "cod", "tilapia", "halibut", "fillet", "bake"]),
        QuickTip(id: "bacon",
                 category: .meatFish,
                 title: "Oven bacon",
                 text: "400°F on a foil-lined sheet pan, no flipping. 15–20 min regular, 20–25 min thick-cut.",
                 keywords: ["bacon", "oven", "sheet pan"]),
        QuickTip(id: "steak",
                 category: .meatFish,
                 title: "Steak doneness",
                 text: "Final temp after resting. Pull it off about 5°F early.",
                 rows: [("Rare", "125°F"), ("Medium-rare", "130–135°F"), ("Medium", "140–145°F"), ("Medium-well", "150–155°F"), ("Well done", "160°F")],
                 note: "USDA safe minimum: 145°F with a 3-minute rest.",
                 keywords: ["steak", "beef", "doneness", "medium rare", "rare", "temp"]),
        QuickTip(id: "safe-temps",
                 category: .tempsConversions,
                 title: "Safe internal temps",
                 text: "Measure at the thickest part with a food thermometer.",
                 rows: [("Poultry, any cut or ground", "165°F"), ("Ground beef, pork, lamb", "160°F"), ("Steaks, chops, roasts", "145°F + 3 min rest"), ("Fish & shellfish", "145°F"), ("Egg dishes", "160°F"), ("Leftovers & casseroles", "165°F")],
                 note: "Source: USDA FSIS",
                 keywords: ["safe", "temperature", "temp", "internal", "chicken", "pork", "beef", "fish", "ground", "usda", "done"]),
        QuickTip(id: "conversions",
                 category: .tempsConversions,
                 title: "Common conversions",
                 rows: [("3 tsp", "1 tbsp"), ("16 tbsp", "1 cup"), ("1 cup", "8 fl oz"), ("1 oz", "28 g"), ("1 lb", "454 g"), ("350°F", "≈ 175°C"), ("400°F", "≈ 200°C"), ("425°F", "≈ 220°C")],
                 keywords: ["convert", "conversion", "tsp", "tbsp", "cup", "oz", "gram", "grams", "celsius", "fahrenheit", "measure"]),
    ]
}

/// White card with the tip, its table rows and a footnote (`.tip-card`).
struct TipCard: View {
    let tip: QuickTip

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(tip.title)
                .font(.poppins(16.5))
                .foregroundStyle(Color.plum)
            if let text = tip.text {
                Text(text)
                    .font(.inter(15.5))
                    .foregroundStyle(Color.text)
                    .lineSpacing(3)
                    .padding(.top, 5)
            }
            if !tip.rows.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(tip.rows.enumerated()), id: \.offset) { _, row in
                        let (label, value) = row
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(label)
                                .foregroundStyle(Color.text)
                            Spacer(minLength: 0)
                            Text(value)
                                .fontWeight(.semibold)
                                .foregroundStyle(Color.plum)
                                .monospacedDigit()
                                .multilineTextAlignment(.trailing)
                        }
                        .font(.inter(15))
                        .padding(.vertical, 7)
                        .overlay(alignment: .top) { Color(hex: 0xF3E7ED).frame(height: 1) }
                    }
                }
                .padding(.top, 8)
            }
            if let note = tip.note {
                Text(note)
                    .font(.inter(13))
                    .foregroundStyle(Color.muted)
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.line))
    }
}

/// Tips matching a Home search, shown above the recipe grid (InlineTips).
struct InlineTips: View {
    let tips: [QuickTip]

    var body: some View {
        if !tips.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("Quick tip", systemImage: "lightbulb")
                    .font(.inter(12.5, weight: .semibold))
                    .textCase(.uppercase)
                    .kerning(0.9)
                    .foregroundStyle(Color.pink)
                    .padding(.horizontal, 2)
                ForEach(tips) { TipCard(tip: $0) }
            }
            .padding(.top, 2)
            .padding(.bottom, 18)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Quick tips")
        }
    }
}

/// "Quick tips" sheet: filter box and the tips grouped by category (QuickTipsSheet).
struct QuickTipsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private struct Group: Identifiable {
        let category: QuickTip.Category
        let tips: [QuickTip]
        var id: String { category.rawValue }
    }

    private var groups: [Group] {
        let hits = QuickTip.search(query)
        return QuickTip.Category.allCases.compactMap { category in
            let tips = hits.filter { $0.category == category }
            return tips.isEmpty ? nil : Group(category: category, tips: tips)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Quick tips")
                    .font(.poppins(22))
                    .foregroundStyle(Color.plum)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.muted)
                        .frame(width: 44, height: 44)
                }
                .padding(.trailing, -12)
                .accessibilityLabel("Close quick tips")
            }
            // No autofocus, like the web: the keyboard would cover the sheet.
            SearchField(text: $query, prompt: "Filter tips", clearLabel: "Clear filter")
                .padding(.top, 10)
                .padding(.bottom, 4)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Color.clear.frame(height: 0).id("top")
                        if groups.isEmpty {
                            Text("No tips for “\(query.trimmingCharacters(in: .whitespaces))” yet. Try “eggs” or “steak”.")
                                .font(.inter(15))
                                .foregroundStyle(Color.muted)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 32)
                        }
                        ForEach(groups) { group in
                            Text(group.category.rawValue)
                                .font(.inter(12.5, weight: .semibold))
                                .textCase(.uppercase)
                                .kerning(0.9)
                                .foregroundStyle(Color.muted)
                                .padding(.horizontal, 2)
                                .padding(.top, 20)
                                .padding(.bottom, 8)
                            VStack(spacing: 8) {
                                ForEach(group.tips) { TipCard(tip: $0) }
                            }
                        }
                    }
                    .padding(.bottom, 42)
                }
                .scrollDismissesKeyboard(.immediately)
                // New filter results start at the top of the list.
                .onChange(of: query) { proxy.scrollTo("top", anchor: .top) }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .presentationDetents([.large])
        .presentationBackground(Color.appBackground)
        .presentationDragIndicator(.visible)
    }
}
