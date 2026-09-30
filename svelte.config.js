import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		adapter: adapter(),
		// API clients (Zotero plugins) send no Origin header; the API is authenticated per request
		csrf: { trustedOrigins: ['*'] },
		inlineStyleThreshold: Infinity
	}
};
