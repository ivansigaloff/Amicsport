import { Redirect } from 'expo-router';
import Head from 'expo-router/head';

export default function Index() {
  return (
    <>
      <Head>
        <link rel="canonical" href="https://multigraf.info/Kickerzbcn/" />
      </Head>
      <Redirect href="/login" />
    </>
  );
}
