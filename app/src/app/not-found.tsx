import Link from "next/link";

export default function NoEncontrada() {
  return (
    <>
      <h1>Esta página no existe</h1>
      <p>
        <Link href="/">Volver al radar</Link>
      </p>
    </>
  );
}
