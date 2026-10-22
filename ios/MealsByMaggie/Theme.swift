import SwiftUI
import CoreText

// Design tokens ported from mbm-ui (src/tokens.css). The web app is light-only,
// so these are plain colors rather than light/dark asset catalog entries.
extension Color {
    static let plum = Color(hex: 0x7B2453)
    static let plum2 = Color(hex: 0x62183F)
    static let pink = Color(hex: 0xD9488B)
    static let appBackground = Color(hex: 0xFCF5F8)
    static let surface = Color.white
    static let chip = Color(hex: 0xF6E5EE)
    static let line = Color(hex: 0xEEDDE6)
    static let dash = Color(hex: 0xD8B9C9)
    static let text = Color(hex: 0x3A2830)
    static let muted = Color(hex: 0x7D6872)
    static let ok = Color(hex: 0x2E7D57)
    static let okBackground = Color(hex: 0xE7F3EC)
    static let warn = Color(hex: 0x8A4A0C)
    static let warnBackground = Color(hex: 0xFDF0DC)
    static let warnLine = Color(hex: 0xEFCF9F)

    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

// Same font families as the web app: Lobster for the logo, Poppins for
// headings, Inter for body text. Files live in the Fonts folder.
extension Font {
    static func lobster(_ size: CGFloat) -> Font {
        AppFonts.register()
        return .custom("Lobster-Regular", size: size)
    }

    static func poppins(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        AppFonts.register()
        return .custom(weight == .medium ? "Poppins-Medium" : "Poppins-SemiBold", size: size)
    }

    static func inter(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        AppFonts.register()
        let name = switch weight {
        case .medium: "Inter-Medium"
        case .semibold: "Inter-SemiBold"
        case .bold, .heavy, .black: "Inter-Bold"
        default: "Inter-Regular"
        }
        return .custom(name, size: size)
    }
}

enum AppFonts {
    /// Registers the bundled .ttf files so Font.custom can find them by name.
    /// Doing it in code avoids having to list each file in Info.plist.
    /// Runs once, on first use, so Xcode previews get the fonts too.
    static func register() { _ = registered }

    private static let registered: Bool = {
        let urls = (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
            + (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [])
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        return true
    }()
}

/// Pill-shaped tag, matching `.chip` / `.chip.on` in tokens.css.
struct TagChip: View {
    let text: String
    var selected = false

    var body: some View {
        Text(text.capitalized)
            .font(.inter(14, weight: selected ? .semibold : .medium))
            .foregroundStyle(selected ? Color.plum : Color.text)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(selected ? Color.chip : Color.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.clear : Color.line))
    }
}

/// Lays children out left-to-right, wrapping onto new lines (CSS flex-wrap).
///
/// Sizing and placement must wrap at the same width, or the stack reserves room
/// for fewer rows than get drawn and the last row slides under the next view
/// (tags under the Time card on the recipe page). So the layout reports the full
/// width it was offered, not its widest row: SwiftUI places it in bounds of the
/// reported size, and a row-width report rounded to the pixel grid can come back
/// a hair narrower than the row, wrapping its last chip during placement only.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        Self.size(for: subviews.map { $0.sizeThatFits(.unspecified) }, proposedWidth: proposal.width, spacing: spacing)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        for row in Self.rows(for: sizes, maxWidth: bounds.width, spacing: spacing) {
            var x = bounds.minX
            for index in row.indices {
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: .unspecified)
                x += sizes[index].width + spacing
            }
        }
    }

    struct Row: Equatable { var indices: [Int] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    /// Rounding room: a row this much wider than the space still fits, so pixel
    /// snapping of the bounds can't push a chip onto a row nobody made room for.
    static let tolerance: CGFloat = 0.5

    /// The size the layout reports: the whole offered width (or the widest row
    /// when the width is open-ended) by the height of every row.
    static func size(for sizes: [CGSize], proposedWidth: CGFloat?, spacing: CGFloat) -> CGSize {
        let maxWidth = proposedWidth ?? .infinity
        let rows = rows(for: sizes, maxWidth: maxWidth, spacing: spacing)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let widest = rows.map(\.width).max() ?? 0
        return CGSize(width: maxWidth.isFinite ? maxWidth : widest, height: height)
    }

    static func rows(for sizes: [CGSize], maxWidth: CGFloat, spacing: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for (index, size) in sizes.enumerated() {
            var row = rows[rows.count - 1]
            if !row.indices.isEmpty && row.width + spacing + size.width > maxWidth + tolerance {
                rows.append(Row(y: row.y + row.height + spacing))
                row = rows[rows.count - 1]
            }
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
