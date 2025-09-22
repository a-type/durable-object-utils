import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
	test: {
		poolOptions: {
			workers: {
				wrangler: {
					configPath: './tests/wrangler.toml',
				},
				isolatedStorage: false,
			},
		},
	},
});
