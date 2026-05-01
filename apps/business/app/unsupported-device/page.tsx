// app/unsupported-device/page.tsx
export default function UnsupportedDevice() {
    return (
      <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', padding: '2rem', textAlign: 'center' }}>
        <h1>Desktop required</h1>
        <p>The OpenBookings business portal is designed for desktop use.<br />Please open this page on a laptop or desktop computer.</p>
      </main>
    );
  }