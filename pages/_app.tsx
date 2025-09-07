import type { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
const DebugDock = dynamic(() => import('../components/DebugDock'), { ssr:false });
export default function App({ Component, pageProps }: AppProps){
  return (<><Component {...pageProps} /><DebugDock/></>);
}
