const API_URL = process.env.NEXT_PUBLIC_API_PREFIX

const rewrites = async () => ([
	{
		source: '/api/:path*',
		destination: `${API_URL}/:path*`,
	},
])

// Next requires basePath to be empty or a "/prefix" with no trailing slash.
// PUBLIC_URL is commonly "/" (e.g. docker-compose), which Next rejects and the
// build fails. Normalize: strip a trailing slash; treat "/" or "" as no prefix.
const rawBasePath = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
const basePath = rawBasePath || undefined

/** @type {import('next').NextConfig} */
const nextConfig = {

	// This app lives in a workspace (gallery/frontend) with its own lockfile,
	// while the monorepo root has another. Next/Turbopack would otherwise infer
	// the monorepo root as the project root and resolve modules at the wrong
	// path (e.g. <root>/frontend/node_modules/...). Pin the root to this dir.
	turbopack: {
		root: __dirname,
	},

	...(process.env.NODE_ENV !== "production" ? {
		rewrites,
	} : {
		output: 'export',
		// Optional: Change the output directory `out` -> `dist`
		distDir: 'build',
		// Optional: Change links `/me` -> `/me/` and emit `/me.html` -> `/me/index.html`
		trailingSlash: true,
	}),

	...(basePath && {
		// assetPrefix: basePath,
		basePath,
	}),


	// Optional: Prevent automatic `/me` -> `/me/`, instead preserve `href`
	// skipTrailingSlashRedirect: true,

}

module.exports = nextConfig