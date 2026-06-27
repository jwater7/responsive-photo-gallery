import Head from 'next/head';
import styles from '../styles/Home.module.css';
import { useEffect, useState } from "react";
import Router from "next/router";
import API from '../lib/api';

import {
  FormControl,
  FormGroup,
  //ControlLabel,
  Button,
} from 'react-bootstrap';

import { usePing } from '../data/use-ping';

export default function Page() {

  const { loggedIn, isLoading } = usePing({ redirect: "/login" });

  // if logged in, redirect to the list
  useEffect(() => {
    if (!isLoading && loggedIn) {
      Router.replace("/home")
      return
    }
  }, [loggedIn]);

  return (
    <div className={styles.container}>
      <Head>
        <title>Responsive Photo Gallery</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>

        <div>
          loading...
        </div>

      </main>

      <footer>
      </footer>

      <style jsx>{`
        main {
          padding: 5rem 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }
        footer {
          width: 100%;
          height: 100px;
          border-top: 1px solid #eaeaea;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        footer img {
          margin-left: 0.5rem;
        }
        footer a {
          display: flex;
          justify-content: center;
          align-items: center;
          text-decoration: none;
          color: inherit;
        }
        code {
          background: #fafafa;
          border-radius: 5px;
          padding: 0.75rem;
          font-size: 1.1rem;
          font-family:
            Menlo,
            Monaco,
            Lucida Console,
            Liberation Mono,
            DejaVu Sans Mono,
            Bitstream Vera Sans Mono,
            Courier New,
            monospace;
        }
      `}</style>

      <style jsx global>{`
        html,
        body {
          padding: 0;
          margin: 0;
          font-family:
            -apple-system,
            BlinkMacSystemFont,
            Segoe UI,
            Roboto,
            Oxygen,
            Ubuntu,
            Cantarell,
            Fira Sans,
            Droid Sans,
            Helvetica Neue,
            sans-serif;
        }
        * {
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
}

Page.getLayout = function getLayout(page) {
  return (page)
}