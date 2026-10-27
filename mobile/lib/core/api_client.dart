import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

class AppException implements Exception {
  const AppException(this.message, {this.status});
  final String message;
  final int? status;
}

/// The same bearer-token contract used by client/src/services/apiClient.js.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.accessToken,
    http.Client? client,
  }) : _baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), ''),
       _client = client ?? http.Client();

  final String _baseUrl;
  final String? Function() accessToken;
  final http.Client _client;

  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
    bool authenticated = true,
  }) async {
    final token = authenticated ? accessToken() : null;
    if (authenticated && token == null) {
      throw const AppException('Please sign in again.', status: 401);
    }
    try {
      final request = http.Request(method, Uri.parse('$_baseUrl$path'));
      request.headers['Content-Type'] = 'application/json';
      if (token != null) request.headers['Authorization'] = 'Bearer $token';
      if (body != null) request.body = jsonEncode(body);
      final response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 25));
      return _decodeResponse(response);
    } on TimeoutException {
      throw const AppException(
        'The connection took too long. Please try again.',
      );
    } on SocketException {
      throw const AppException('Check your internet connection and try again.');
    } on http.ClientException {
      throw const AppException('Could not connect. Please try again.');
    }
  }

  Future<dynamic> uploadMultipart(
    String path, {
    required String fieldName,
    required List<int> bytes,
    required String filename,
    Map<String, String>? fields,
    bool authenticated = true,
  }) async {
    final token = authenticated ? accessToken() : null;
    if (authenticated && token == null) {
      throw const AppException('Please sign in again.', status: 401);
    }
    try {
      final request = http.MultipartRequest('POST', Uri.parse('$_baseUrl$path'));
      if (token != null) request.headers['Authorization'] = 'Bearer $token';
      if (fields != null) request.fields.addAll(fields);
      request.files.add(
        http.MultipartFile.fromBytes(
          fieldName,
          bytes,
          filename: filename,
        ),
      );
      final response = await _client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 45));
      return _decodeResponse(response);
    } on TimeoutException {
      throw const AppException(
        'The connection took too long. Please try again.',
      );
    } on SocketException {
      throw const AppException('Check your internet connection and try again.');
    } on http.ClientException {
      throw const AppException('Could not connect. Please try again.');
    }
  }

  dynamic _decodeResponse(http.Response response) {
    dynamic payload;
    try {
      payload = response.body.isEmpty ? null : jsonDecode(response.body);
    } on FormatException {
      throw const AppException(
        'The service returned an unreadable response.',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      // Do not display backend internals or submitted identifiers.
      final message = switch (response.statusCode) {
        401 => 'Your session has expired. Please sign in again.',
        403 => 'This account cannot access this information.',
        404 => 'This record could not be found. Please contact your clinic.',
        410 => 'This invitation has expired or has already been used.',
        429 => 'Too many attempts. Please wait a moment and try again.',
        _ => 'We could not complete that request. Please try again.',
      };
      throw AppException(message, status: response.statusCode);
    }
    return payload;
  }

  void close() => _client.close();
}
