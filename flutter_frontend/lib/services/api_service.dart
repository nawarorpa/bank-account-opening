import 'dart:convert';
import 'dart:typed_data';
import 'package:http_parser/http_parser.dart';
import 'package:http/http.dart' as http;

MediaType? _mediaTypeFor(String filename) {
  final ext = filename.split('.').last.toLowerCase();
  switch (ext) {
    case 'pdf':
      return MediaType('application', 'pdf');
    case 'jpg':
    case 'jpeg':
      return MediaType('image', 'jpeg');
    case 'png':
      return MediaType('image', 'png');
    default:
      return null;
  }
}

class ApiService {
  ApiService({String? baseUrl})
      : baseUrl = baseUrl ??
            const String.fromEnvironment(
              'API_BASE_URL',
             defaultValue: 'http://10.25.187.4:4000/api',
            );

  final String baseUrl;

  Future<Map<String, dynamic>> createApplication(
    Map<String, dynamic> payload,
  ) async {
    final response = await http.post(
      Uri.parse('$baseUrl/applications'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );
    if (response.statusCode != 201) {
      throw Exception('Could not create application: ${response.body}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> uploadDocument({
    required String applicationId,
    required String documentType,
    required String filename,
    required Uint8List bytes,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/applications/$applicationId/documents'),
    );
    request.fields['documentType'] = documentType;
        request.files.add(
      http.MultipartFile.fromBytes(
        'file',
        bytes,
        filename: filename,
        contentType: _mediaTypeFor(filename),
      ),
    );
    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode != 201) {
      throw Exception('Document upload failed: ${response.body}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> submitApplication(String id) async {
    final response = await http.post(
      Uri.parse('$baseUrl/applications/$id/submit'),
    );
    if (response.statusCode != 200) {
      throw Exception('Could not submit application: ${response.body}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }
}
