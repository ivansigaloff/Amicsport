import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * This file is web-only and used to configure the root HTML for every
 * web page during static rendering.
 * The children are the entry point of your app, which is usually `_layout.tsx`.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        {/* 
          Standard Head injection for Expo Router.
          This will inject the canonical tags from Head components in pages.
        */}
        <ScrollViewStyleReset />

        <style id="expo-reset">
          {`#root,body,html{height:100%}body{overflow:hidden}#root{display:flex}`}
        </style>
      </head>
      <body>{children}</body>
    </html>
  );
}
