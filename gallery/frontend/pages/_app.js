import Head from 'next/head'
import Layout from '../components/layout'
import 'bootstrap/dist/css/bootstrap.css'

export default function MyApp({ Component, pageProps }) {
    // Use the layout defined at the page level to override default
    const getLayout = Component.getLayout ?? ((page) => (
        <Layout>{page}</Layout>
    ))

    return (
        <>
            {/* Next's defaultHead injects `width=device-width` WITHOUT
                `initial-scale=1`. On iOS Safari that lets any horizontal overflow
                shrink-to-fit the whole layout (header + controls), not just the
                offending element — the mobile-only chrome-shrink in TODO Bugfix #2.
                Pinning initial-scale stops it; overriding here (keyed on the
                `viewport` name) wins over the default on every page/layout. */}
            <Head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
            </Head>
            {getLayout(<Component {...pageProps} />)}
        </>
    )
}

