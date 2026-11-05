import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import 'auth_controller.dart';
import 'auth_widgets.dart';

class SignupPage extends StatefulWidget {
  const SignupPage({super.key, required this.auth});

  final AuthController? auth;

  @override
  State<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends State<SignupPage> {
  final _form = GlobalKey<FormState>();
  final _fullName = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();

  @override
  void dispose() {
    _fullName.dispose();
    _email.dispose();
    _phone.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (widget.auth == null || widget.auth!.busy) return;
    if (!_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();

    await widget.auth!.signUp(
      email: _email.text,
      password: _password.text,
      fullName: _fullName.text,
      phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
    );

    if (!mounted) return;
    if (widget.auth!.error == null && Navigator.canPop(context)) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = widget.auth?.busy ?? false;
    final configured = widget.auth != null;

    return AuthFrame(
      showBack: true,
      children: [
        const BrandHeader(),
        const SizedBox(height: 36),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFE4F0EF),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Row(
            children: [
              Icon(Icons.person_add_alt_1_rounded, size: 17, color: primary),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Join MedBrief as a new patient',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                    color: primary,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const Text(
          'Create your account',
          style: TextStyle(
            color: ink,
            fontSize: 32,
            height: 1.15,
            fontWeight: FontWeight.w800,
            letterSpacing: -1,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Track your vitals, visit summaries, and join our patient care community.',
          style: TextStyle(color: muted, fontSize: 15, height: 1.5),
        ),
        const SizedBox(height: 24),
        ErrorNotice(widget.auth?.error),
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _fullName,
                enabled: !busy,
                decoration: const InputDecoration(
                  labelText: 'Full name',
                  hintText: 'Jane Doe',
                  prefixIcon: Icon(Icons.badge_outlined, size: 21),
                ),
                textInputAction: TextInputAction.next,
                textCapitalization: TextCapitalization.words,
                validator: (val) {
                  if (val == null || val.trim().isEmpty) {
                    return 'Enter your full name.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _email,
                enabled: !busy,
                decoration: const InputDecoration(
                  labelText: 'Email address',
                  hintText: 'you@example.com',
                  prefixIcon: Icon(Icons.mail_outline_rounded, size: 21),
                ),
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                textCapitalization: TextCapitalization.none,
                autocorrect: false,
                autofillHints: const [AutofillHints.email],
                validator: validateEmail,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _phone,
                enabled: !busy,
                decoration: const InputDecoration(
                  labelText: 'Phone number (optional)',
                  hintText: '+1 555-0100',
                  prefixIcon: Icon(Icons.phone_outlined, size: 21),
                ),
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),
              PasswordInput(
                controller: _password,
                enabled: !busy,
                newPassword: true,
                validator: (val) {
                  if (val == null || val.isEmpty) {
                    return 'Enter a password.';
                  }
                  if (val.length < 8) {
                    return 'Password must be at least 8 characters.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              PasswordInput(
                controller: _confirmPassword,
                label: 'Confirm password',
                enabled: !busy,
                newPassword: true,
                validator: (val) {
                  if (val == null || val.isEmpty) {
                    return 'Confirm your password.';
                  }
                  if (val != _password.text) {
                    return 'Passwords do not match.';
                  }
                  return null;
                },
                onSubmitted: _submit,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: configured && !busy ? _submit : null,
                child: buttonLabel('Create account', busy),
              ),
              const SizedBox(height: 14),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text(
                    'Already have an account? ',
                    style: TextStyle(color: muted, fontSize: 14),
                  ),
                  TextButton(
                    onPressed: busy ? null : () => Navigator.of(context).pop(),
                    child: const Text('Sign in'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
