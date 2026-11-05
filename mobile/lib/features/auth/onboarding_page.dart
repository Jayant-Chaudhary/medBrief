import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import 'auth_controller.dart';
import 'auth_widgets.dart';

class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key, required this.auth});
  final AuthController auth;

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.auth.profile?.fullName);
  late final _phone = TextEditingController(text: widget.auth.profile?.phone);

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (widget.auth.busy || !_form.currentState!.validate()) return;
    await widget.auth.completeProfile(_name.text, _phone.text);
  }

  @override
  Widget build(BuildContext context) => AuthFrame(
    children: [
      const BrandHeader(),
      const SizedBox(height: 40),
      const Text(
        'A little about you',
        style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: 12),
      const Text(
        'Help your care team recognise and reach you.',
        style: TextStyle(color: muted, height: 1.5),
      ),
      const SizedBox(height: 28),
      ErrorNotice(widget.auth.error),
      Form(
        key: _form,
        child: Column(
          children: [
            TextFormField(
              controller: _name,
              enabled: !widget.auth.busy,
              decoration: const InputDecoration(labelText: 'Full name'),
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              textInputAction: TextInputAction.next,
              maxLength: 200,
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Enter your full name.'
                  : null,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _phone,
              enabled: !widget.auth.busy,
              decoration: const InputDecoration(labelText: 'Phone number'),
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              maxLength: 200,
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Enter a contact number.'
                  : null,
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: widget.auth.busy ? null : _save,
              child: buttonLabel('Save and continue', widget.auth.busy),
            ),
          ],
        ),
      ),
      const SizedBox(height: 16),
      TextButton(
        onPressed: widget.auth.busy ? null : widget.auth.signOut,
        child: const Text('Sign out'),
      ),
    ],
  );
}
