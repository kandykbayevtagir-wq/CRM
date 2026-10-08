"use client";

export default function ScreenError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="screen-recovery" role="alert">
    <section>
      <h1>Не удалось открыть экран</h1>
      <p>Ваши данные хранятся в CRM. Попробуйте загрузить экран ещё раз. Если ошибка повторяется, вернитесь в кабинет.</p>
      <button type="button" onClick={reset}>Попробовать снова</button>
      <a href="/">Вернуться в кабинет</a>
    </section>
  </main>;
}
