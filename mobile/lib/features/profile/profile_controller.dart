import 'package:flutter/foundation.dart';
import '../../core/api_client.dart';
import 'profile_repository.dart';

class ProfileController extends ChangeNotifier {
  ProfileController({required this.repo});

  final ProfileRepository repo;

  PatientProfileData? profile;
  bool isLoading = false;
  bool isSaving = false;
  String? errorMessage;
  String? successMessage;

  Future<void> load() async {
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      profile = await repo.getProfile();
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Could not load your profile.';
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> save(PatientProfileData updated) async {
    isSaving = true;
    errorMessage = null;
    successMessage = null;
    notifyListeners();

    try {
      await repo.updateProfile(updated.toJson());
      profile = updated;
      successMessage = 'Profile updated successfully.';
      notifyListeners();
      return true;
    } catch (e) {
      errorMessage = e is AppException ? e.message : 'Could not save profile.';
      notifyListeners();
      return false;
    } finally {
      isSaving = false;
      notifyListeners();
    }
  }

  void clearMessage() {
    successMessage = null;
    errorMessage = null;
    notifyListeners();
  }
}

