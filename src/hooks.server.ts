// Fails at startup on a broken configuration instead of on the first request.
import { config } from '$lib/server/config';

try {
	const cfg = config();
	console.log(`Semantic Scholar Bridge: auth=${cfg.auth.join(',')} rate=${cfg.ratePerSec}/s upstream=${cfg.s2BaseUrl}${cfg.s2ApiKey ? '' : ' (no S2_API_KEY: shared anonymous quota)'}`);
} catch (e) {
	console.error(`Configuration error: ${(e as Error).message}`);
	process.exit(1);
}
