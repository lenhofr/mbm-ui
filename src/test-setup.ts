import '@testing-library/jest-dom'

// jsdom doesn't implement matchMedia by default; stub it for components using it
// Some jsdom versions define the property but not as a function
if (typeof window.matchMedia !== 'function') {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).matchMedia = (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {}, // deprecated
		removeListener: () => {}, // deprecated
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	})
}
