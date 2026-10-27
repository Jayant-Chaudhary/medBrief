import '../../core/api_client.dart';

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

class PatientProfileData {
  const PatientProfileData({
    required this.fullName,
    this.phone,
    this.dateOfBirth,
    this.bloodType,
    this.address,
    this.emergencyContactName,
    this.emergencyContactPhone,
    this.role = 'patient',
  });

  factory PatientProfileData.fromJson(Map<String, dynamic> json) =>
      PatientProfileData(
        fullName: json['fullName'] as String? ?? json['full_name'] as String? ?? '',
        phone: json['phone'] as String?,
        dateOfBirth: json['dateOfBirth'] as String? ?? json['date_of_birth'] as String?,
        bloodType: json['bloodType'] as String? ?? json['blood_type'] as String?,
        address: json['address'] as String?,
        emergencyContactName: json['emergencyContactName'] as String? ??
            json['emergency_contact_name'] as String?,
        emergencyContactPhone: json['emergencyContactPhone'] as String? ??
            json['emergency_contact_phone'] as String?,
        role: json['role'] as String? ?? 'patient',
      );

  final String fullName;
  final String? phone;
  final String? dateOfBirth;
  final String? bloodType;
  final String? address;
  final String? emergencyContactName;
  final String? emergencyContactPhone;
  final String role;

  Map<String, dynamic> toJson() => {
        'fullName': fullName.trim().isEmpty ? null : fullName.trim(),
        'phone': phone?.trim().isEmpty == true ? null : phone?.trim(),
        'dateOfBirth': dateOfBirth?.trim().isEmpty == true ? null : dateOfBirth?.trim(),
        'bloodType': bloodType?.trim().isEmpty == true ? null : bloodType?.trim(),
        'address': address?.trim().isEmpty == true ? null : address?.trim(),
        'emergencyContactName':
            emergencyContactName?.trim().isEmpty == true ? null : emergencyContactName?.trim(),
        'emergencyContactPhone':
            emergencyContactPhone?.trim().isEmpty == true ? null : emergencyContactPhone?.trim(),
      };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class ProfileRepository {
  const ProfileRepository({this.api});
  final ApiClient? api;

  Future<PatientProfileData?> getProfile() async {
    final client = api;
    if (client == null) return null;
    final res = await client.request('/api/profile');
    if (res is! Map<String, dynamic>) return null;
    return PatientProfileData.fromJson(res);
  }

  Future<void> updateProfile(Map<String, dynamic> changes) async {
    final client = api;
    if (client == null) return;
    await client.request(
      '/api/profile',
      method: 'PATCH',
      body: changes,
    );
  }
}

