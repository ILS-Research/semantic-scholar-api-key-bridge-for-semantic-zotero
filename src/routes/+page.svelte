<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Semantic Scholar Bridge</title></svelte:head>

<main>
	<h1>Semantic Scholar Bridge</h1>
	<p>
		Forwards requests from <a href="https://github.com/AgiNetz/semantic-zotero">Semantic Zotero</a> and MCP servers to the
		<a href="https://www.semanticscholar.org/product/api">Semantic Scholar API</a> with a shared key.
	</p>
	{#if data.enabled}
		<table>
			<tbody>
				<tr><th>Authentication</th><td>{data.auth.join(', ')}</td></tr>
				<tr><th>Rate limit</th><td>{data.ratePerSec} requests/s</td></tr>
				<tr><th>Running since</th><td>{data.stats.startedAt}</td></tr>
				<tr><th>Requests</th><td>{data.stats.requests}</td></tr>
				<tr><th>Answered from cache</th><td>{data.stats.cacheHits}</td></tr>
				<tr><th>Sent to Semantic Scholar</th><td>{data.stats.upstreamRequests} (retries after 429: {data.stats.upstreamRetries})</td></tr>
				<tr><th>Refused (authentication / path / client scope)</th><td>{data.stats.rejectedAuth} / {data.stats.rejectedPath} / {data.stats.rejectedScope}</td></tr>
				<tr><th>Too many waiting (429)</th><td>{data.stats.overQueued}</td></tr>
				<tr><th>Busy (503) / errors</th><td>{data.stats.busy} / {data.stats.errors}</td></tr>
				<tr><th>Cache</th><td>{data.cache.entries} entries, {(data.cache.bytes / 1048576).toFixed(1)} MB</td></tr>
				<tr><th>Waiting now</th><td>{data.waiting}</td></tr>
			</tbody>
		</table>
		{#if data.clients.length}
			<h2>Per client</h2>
			<table>
				<thead><tr><th>Client</th><th>Requests</th><th>To Semantic Scholar</th><th>Avg. time</th></tr></thead>
				<tbody>
					{#each data.clients as c (c.name)}
						<tr><td>{c.name}</td><td>{c.requests}</td><td>{c.upstream}</td><td>{c.avgMs} ms</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}
</main>

<style>
	main { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
	th { text-align: left; padding-right: 1.5rem; font-weight: 500; }
	td, th { padding-block: 0.2rem; padding-right: 1.5rem; }
	h2 { font-size: 1.1rem; margin-top: 1.5rem; }
</style>
