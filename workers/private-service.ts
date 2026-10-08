/** Bound both the service fetch and body read; do not include URLs, bodies or secrets in errors. */
export async function privateService<T>(binding: Fetcher, path: string, init: RequestInit,
  consume: (response: Response) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      binding.fetch('https://internal'+path,{...init,signal:controller.signal}).then(consume),
      new Promise<never>((_, reject) => { timer=setTimeout(() => {
        controller.abort(); reject(new Error('PRIVATE_SERVICE_TIMEOUT'));
      },timeoutMs); }),
    ]);
  } finally { if(timer) clearTimeout(timer); }
}
