/**
 * Минимальные типы Deno-рантайма — ровно то подмножество API, что реально
 * используется в index.ts обеих функций (Deno.env.get, Deno.serve). Не
 * замена официальных @deno/types: если понадобится больше поверхности API,
 * дополняй здесь, а не подавляй ошибки через any/ts-ignore.
 */
declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
  function serve(handler: (req: Request) => Response | Promise<Response>): void;
}
