import SwiftUI
import UIKit

/// Full-screen recipe photo, opened by tapping the photo on the recipe page.
/// Pinch or double-tap to zoom, drag to pan, swipe down (or ✕) to close.
/// iOS-only; the web shows the photo in its hero only.
struct PhotoViewer: View {
    let url: URL
    let title: String
    @Environment(\.dismiss) private var dismiss

    @State private var image: UIImage?
    @State private var failed = false
    /// 0…1 while swiping down to close; fades the backdrop and the close button.
    @State private var dismissProgress: CGFloat = 0

    var body: some View {
        ZStack {
            Color.black
                .opacity(1 - dismissProgress * 0.8)
                .ignoresSafeArea()

            if let image {
                ZoomableImage(image: image, onDismissProgress: { dismissProgress = $0 }, onDismiss: { dismiss() })
                    .ignoresSafeArea()
                    .accessibilityLabel("Photo of \(title)")
            } else if failed {
                Text("We couldn’t load this photo.")
                    .font(.inter(15))
                    .foregroundStyle(.white.opacity(0.8))
            } else {
                ProgressView().tint(.white)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(.white.opacity(0.18), in: Circle())
            }
            .accessibilityLabel("Close photo")
            .padding(.trailing, 16)
            .padding(.top, 8)
            .opacity(1 - dismissProgress)
        }
        .statusBarHidden()
        .presentationBackground(.clear)
        .task { await load() }
    }

    /// Same URL as the recipe page's AsyncImage, so it usually comes from the URL cache.
    private func load() async {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            if let loaded = UIImage(data: data) { image = loaded } else { failed = true }
        } catch {
            failed = true
        }
    }
}

/// UIScrollView-backed image: native pinch/double-tap zoom and panning, plus a
/// swipe-down-to-close pan that only starts when the photo isn't zoomed in.
private struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    var onDismissProgress: (CGFloat) -> Void
    var onDismiss: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = CenteringScrollView()
        scrollView.delegate = context.coordinator
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 4
        scrollView.bouncesZoom = true
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.backgroundColor = .clear

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        scrollView.addSubview(imageView)
        scrollView.imageView = imageView
        context.coordinator.scrollView = scrollView

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)

        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.panned(_:)))
        pan.delegate = context.coordinator
        scrollView.addGestureRecognizer(pan)
        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, UIScrollViewDelegate, UIGestureRecognizerDelegate {
        var parent: ZoomableImage
        weak var scrollView: CenteringScrollView?

        init(_ parent: ZoomableImage) { self.parent = parent }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            (scrollView as? CenteringScrollView)?.imageView
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            (scrollView as? CenteringScrollView)?.centerImage()
        }

        /// Double-tap zooms in on the tapped spot, or back out to fit.
        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scrollView, let imageView = scrollView.imageView else { return }
            if scrollView.zoomScale > scrollView.minimumZoomScale {
                scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
            } else {
                let point = gesture.location(in: imageView)
                let scale = min(scrollView.maximumZoomScale, 2.5)
                let size = CGSize(width: scrollView.bounds.width / scale, height: scrollView.bounds.height / scale)
                scrollView.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2,
                                           width: size.width, height: size.height), animated: true)
            }
        }

        /// Swipe down to close: the photo follows the finger and the backdrop fades.
        @objc func panned(_ gesture: UIPanGestureRecognizer) {
            guard let scrollView, let imageView = scrollView.imageView else { return }
            let translation = gesture.translation(in: scrollView)
            let progress = min(1, abs(translation.y) / 300)
            switch gesture.state {
            case .changed:
                imageView.transform = CGAffineTransform(translationX: translation.x * 0.4, y: translation.y)
                    .scaledBy(x: 1 - progress * 0.15, y: 1 - progress * 0.15)
                parent.onDismissProgress(progress)
            case .ended, .cancelled:
                let velocity = gesture.velocity(in: scrollView).y
                if gesture.state == .ended, abs(translation.y) > 120 || abs(velocity) > 900 {
                    parent.onDismiss()
                } else {
                    UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0) {
                        imageView.transform = .identity
                    }
                    parent.onDismissProgress(0)
                }
            default:
                break
            }
        }

        /// The close pan only starts on a mostly-vertical drag at normal zoom, so it
        /// never fights with panning around a zoomed-in photo.
        func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
            guard let pan = gesture as? UIPanGestureRecognizer, let scrollView, pan.view === scrollView,
                  pan !== scrollView.panGestureRecognizer else { return true }
            let velocity = pan.velocity(in: scrollView)
            return scrollView.zoomScale <= scrollView.minimumZoomScale && abs(velocity.y) > abs(velocity.x)
        }

        /// At normal zoom the scroll view's own pan has nothing to scroll; let both run.
        func gestureRecognizer(_ gesture: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            other === scrollView?.panGestureRecognizer
        }
    }
}

/// Lays the image out to fit the screen and keeps it centered while zoomed out.
private final class CenteringScrollView: UIScrollView {
    weak var imageView: UIImageView?
    private var laidOutSize: CGSize = .zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let imageView, let image = imageView.image, bounds.size != laidOutSize, bounds.width > 0 else { return }
        laidOutSize = bounds.size
        zoomScale = 1
        let fit = min(bounds.width / image.size.width, bounds.height / image.size.height)
        imageView.frame = CGRect(origin: .zero, size: CGSize(width: image.size.width * fit, height: image.size.height * fit))
        contentSize = imageView.frame.size
        centerImage()
    }

    func centerImage() {
        let x = max(0, (bounds.width - contentSize.width) / 2)
        let y = max(0, (bounds.height - contentSize.height) / 2)
        contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }
}

#Preview {
    PhotoViewer(url: URL(string: "https://picsum.photos/1200/900")!, title: "Preview")
}
