import gql from "graphql-tag";
import { execute } from "../../core/execute";
import { HttpLink } from "../HttpLink";
import { itAsync, subscribeAndCount } from "../../../testing";
import type { Observable } from "zen-observable-ts";
import { TextEncoder, TextDecoder } from "util";
import { ReadableStream } from "web-streams-polyfill/ponyfill/es2018";
import { Readable } from "stream";

const sampleDeferredQuery = gql`
  query SampleDeferredQuery {
    stub {
      id
      ... on Stub @defer {
        name
      }
    }
  }
`;

const BOUNDARY = 'gc0p4Jq0M2Yt08jU534c0p';

function matchesResults<T>(
  resolve: () => void,
  reject: (err: any) => void,
  observable: Observable<T>,
  results: Array<T>
) {
  // TODO: adding a second observer to the observable will consume the
  // observable. I want to test completion, but the subscribeAndCount API
  // doesn’t have anything like that.
  subscribeAndCount(reject, observable, (count, result) => {
    // subscribeAndCount is 1-indexed for some terrible reason.
    if (0 >= count || count > results.length) {
      reject(new Error("Unexpected result"));
    }

    expect(result).toEqual(results[count - 1]);
    if (count === results.length) {
      resolve();
    }
  });
}

describe("multipart responses", () => {
  let originalTextDecoder: any;
  beforeAll(() => {
    originalTextDecoder = TextDecoder;
    (globalThis as any).TextDecoder = TextDecoder;
  });

  afterAll(() => {
    globalThis.TextDecoder = originalTextDecoder;
  });

  const body1 = [
    `--${BOUNDARY}`,
    "Content-Type: application/json; charset=utf-8",
    "Content-Length: 43",
    "",
    '{"data":{"stub":{"id":"0"}},"hasNext":true}',
    `--${BOUNDARY}`,
    "Content-Type: application/json; charset=utf-8",
    "Content-Length: 58",
    "",
    '{"data":{"name":"stubby"},"path":["stub"],"hasNext":false}',
    `--${BOUNDARY}--`,
  ].join("\r\n");

  const body2 = [
    `---`,
    "Content-Type: application/json; charset=utf-8",
    "Content-Length: 43",
    "",
    '{"data":{"stub":{"id":"0"}},"hasNext":true}',
    `---`,
    "Content-Type: application/json; charset=utf-8",
    "Content-Length: 58",
    "",
    '{"data":{"name":"stubby"},"path":["stub"],"hasNext":false}',
    `-----`,
  ].join("\r\n");

  const results1 = [
    {
      data: {
        stub: {
          id: "0",
        },
      },
      hasNext: true,
    },
    {
      data: {
        name: "stubby",
      },
      path: ["stub"],
      hasNext: false,
    },
  ];

  itAsync("can handle string bodies", (resolve, reject) => {
    const fetch = jest.fn(async () => ({
      status: 200,
      body: body1,
      headers: { "Content-Type": `multipart/mixed; boundary=${BOUNDARY}` },
    }));

    const link = new HttpLink({
      fetch: fetch as any,
    });

    const observable = execute(link, { query: sampleDeferredQuery });
    matchesResults(resolve, reject, observable, results1);
  });

  itAsync("can handle node buffer bodies", (resolve, reject) => {
    const fetch = jest.fn(async () => ({
      status: 200,
      body: Buffer.from(body1, "utf8"),
      headers: { "content-type": `multipart/mixed; boundary=${BOUNDARY}` },
    }));
    const link = new HttpLink({
      fetch: fetch as any,
    });

    const observable = execute(link, { query: sampleDeferredQuery });
    matchesResults(resolve, reject, observable, results1);
  });

  itAsync("can handle typed arrays bodies", (resolve, reject) => {
    const fetch = jest.fn(async () => ({
      status: 200,
      body: new TextEncoder().encode(body1),
      headers: new Headers({ "content-type": `multipart/mixed; boundary=${BOUNDARY}` }),
    }));
    const link = new HttpLink({
      fetch: fetch as any,
    });

    const observable = execute(link, { query: sampleDeferredQuery });
    matchesResults(resolve, reject, observable, results1);
  });

  itAsync("can handle whatwg stream bodies", (resolve, reject) => {
    const stream = new ReadableStream({
      async start(controller) {
        const lines = body1.split("\r\n");
        try {
          for (const line of lines) {
            controller.enqueue(line + "\r\n");
          }
        } finally {
          controller.close();
        }
      },
    });

    const fetch = jest.fn(async () => ({
      status: 200,
      body: stream,
      headers: new Headers({ "content-type": `multipart/mixed; boundary=${BOUNDARY}` }),
    }));

    const link = new HttpLink({
      fetch: fetch as any,
    });

    const observable = execute(link, { query: sampleDeferredQuery });
    matchesResults(resolve, reject, observable, results1);
  });

  itAsync(
    "can handle whatwg stream bodies with arbitrary splits",
    (resolve, reject) => {
      const stream = new ReadableStream({
        async start(controller) {
          let chunks: Array<string> = [];
          let chunkSize = 15;
          for (let i = 0; i < body1.length; i += chunkSize) {
            chunks.push(body1.slice(i, i + chunkSize));
          }

          try {
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }
          } finally {
            controller.close();
          }
        },
      });

      const fetch = jest.fn(async () => ({
        status: 200,
        body: stream,
        headers: new Headers({ "content-type": `multipart/mixed; boundary=${BOUNDARY}` }),
      }));

      const link = new HttpLink({
        fetch: fetch as any,
      });

      const observable = execute(link, { query: sampleDeferredQuery });
      matchesResults(resolve, reject, observable, results1);
    }
  );

  itAsync("can handle node stream bodies", (resolve, reject) => {
    const stream = Readable.from(
      body2.split("\r\n").map((line) => line + "\r\n")
    );

    const fetch = jest.fn(async () => ({
      status: 200,
      body: stream,
      // if no boundary is specified, default to -
      headers: { "content-type": `multipart/mixed` },
    }));
    const link = new HttpLink({
      fetch: fetch as any,
    });

    const observable = execute(link, { query: sampleDeferredQuery });
    matchesResults(resolve, reject, observable, results1);
  });

  itAsync(
    "can handle node stream bodies with arbitrary splits",
    (resolve, reject) => {
      let chunks: Array<string> = [];
      let chunkSize = 15;
      for (let i = 0; i < body1.length; i += chunkSize) {
        chunks.push(body1.slice(i, i + chunkSize));
      }
      const stream = Readable.from(chunks);

      const fetch = jest.fn(async () => ({
        status: 200,
        body: stream,
        headers: { "content-type": `multipart/mixed; boundary=${BOUNDARY}` },
      }));
      const link = new HttpLink({
        fetch: fetch as any,
      });

      const observable = execute(link, { query: sampleDeferredQuery });
      matchesResults(resolve, reject, observable, results1);
    }
  );
});
