import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_widgets.dart';

/// Authentication landing only. The appointment dashboard is the next slice.
class SignedInPage extends StatelessWidget {
  const SignedInPage({super.key, required this.auth});
  final AuthController auth;

  @override
  Widget build(BuildContext context) => AuthFrame(
    children: [
      const BrandHeader(),
      const SizedBox(height: 40),
      const Icon(Icons.check_circle_outline_rounded, color: primary, size: 60),
      const SizedBox(height: 24),
      Text(
        'Welcome, ${auth.profile!.fullName}',
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 12),
      const Text(
        'You are signed in to your patient account.',
        textAlign: TextAlign.center,
        style: TextStyle(color: muted, fontSize: 16, height: 1.6),
      ),
      const SizedBox(height: 28),
      ErrorNotice(auth.error),
      OutlinedButton(
        onPressed: auth.busy ? null : auth.signOut,
        child: const Text('Sign out'),
      ),
    ],
  );
}
