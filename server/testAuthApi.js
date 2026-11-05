process.env.NODE_ENV = 'test';
const app = require('./src/app');
const env = require('./src/config/env');

async function testServerApis() {
  const PORT = 4001; // use separate port for test
  const server = app.listen(PORT, async () => {
    console.log(`Test server running on http://localhost:${PORT}`);

    try {
      const baseUrl = `http://localhost:${PORT}`;
      const testEmail = `doctor_test_${Date.now()}@gmail.com`;
      const testPassword = 'Password123!';

      // 1. Health check
      console.log('\n--- 1. Testing GET /health ---');
      const healthRes = await fetch(`${baseUrl}/health`);
      const healthData = await healthRes.json();
      console.log('Health Response:', healthData);

      // 2. Signup endpoint
      console.log('\n--- 2. Testing POST /auth/signup ---');
      const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
          fullName: 'Dr. John Smith',
          role: 'clinician',
          phone: '+1987654321',
        }),
      });
      const signupData = await signupRes.json();
      console.log('Signup Status:', signupRes.status);
      console.log('Signup Response:', signupData);

      // 3. Sign in with Supabase Auth directly, as the web and mobile apps do.
      // The server has no /login: it would sign in on the shared service-role client.
      console.log('\n--- 3. Signing in through Supabase Auth (anon key) ---');
      const { createClient } = require('@supabase/supabase-js');
      const anonClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: signIn, error: signInError } = await anonClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });
      console.log('Sign-in error code:', signInError?.code ?? null);
      const accessToken = signIn?.session?.access_token;
      console.log('Access Token Received:', Boolean(accessToken));

      // 4. Authenticated /auth/me endpoint
      if (accessToken) {
        console.log('\n--- 4. Testing GET /auth/me with JWT Bearer Token ---');
        const meRes = await fetch(`${baseUrl}/api/auth/me`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        const meData = await meRes.json();
        console.log('Me Status:', meRes.status);
        console.log('Me Response User:', meData.user);
      }

      // 5. Logout endpoint
      console.log('\n--- 5. Testing POST /auth/logout ---');
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
      });
      const logoutData = await logoutRes.json();
      console.log('Logout Response:', logoutData);

      console.log('\n========================================');
      console.log('ALL SERVER AUTH API TESTS COMPLETED!');
      console.log('========================================');
    } catch (err) {
      console.error('Test Execution Error:', err);
    } finally {
      server.close();
      process.exit(0);
    }
  });
}

testServerApis();
