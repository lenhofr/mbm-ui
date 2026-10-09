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
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: .unspecified)
                x += size.width + spacing
            }
        }
    }

    private struct Row { var indices: [Int] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            var row = rows[rows.count - 1]
            if !row.indices.isEmpty && row.width + spacing + size.width > maxWidth {
                let nextY = row.y + row.height + spacing
                rows.append(Row(y: nextY))
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
