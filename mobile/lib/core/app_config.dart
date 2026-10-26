class AppConfig {
  const AppConfig({
    required this.supabaseUrl,
    required this.supabaseKey,
    required this.apiBaseUrl,
  });

  const AppConfig.fromEnvironment()
    : supabaseUrl = const String.fromEnvironment('SUPABASE_URL'),
      supabaseKey = const String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY'),
      apiBaseUrl = const String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://10.0.2.2:4000',
      );

  final String supabaseUrl;
  final String supabaseKey;
  final String apiBaseUrl;

  bool get isConfigured =>
      Uri.tryParse(supabaseUrl)?.hasAuthority == true &&
      supabaseKey.isNotEmpty &&
      Uri.tryParse(apiBaseUrl)?.hasAuthority == true;
}
