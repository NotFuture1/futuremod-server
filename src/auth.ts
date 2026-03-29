export function isValidToken(token: string | undefined): boolean {
    return !!token && token === process.env.API_TOKEN;
}