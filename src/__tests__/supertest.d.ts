declare module 'supertest' {
  interface Test {
    set(field: string, value: string): Test
    send(body: unknown): Test
    expect(status: number): Promise<Response>
  }

  interface Response {
    status: number
    body: any
    headers: Record<string, string | string[] | undefined>
  }

  interface SuperTest {
    get(path: string): Test
    post(path: string): Test
    put(path: string): Test
    patch(path: string): Test
    delete(path: string): Test
  }

  function request(app: unknown): SuperTest
  export default request
}
