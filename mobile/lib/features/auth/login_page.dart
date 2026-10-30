import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/app_theme.dart';
import 'auth_controller.dart';
import 'auth_widgets.dart';
import 'invite_page.dart';
import 'signup_page.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.auth, this.setupError});
  final AuthController? auth;
  final String? setupError;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (widget.auth == null || widget.auth!.busy) return;
    if (!_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    await widget.auth!.signIn(_email.text, _password.text);
    if (!mounted) return;
    if (widget.auth!.error == null) {
      TextInput.finishAutofillContext();
    }
  }

  Future<void> _openSignup() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => SignupPage(auth: widget.auth),
      ),
    );
  }

  Future<void> _openInvite() async {
    final email = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => InvitePage(repository: widget.auth!.repository),
      ),
    );
    if (!mounted || email == null) return;
    _email.text = email;
    _password.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Your account is ready. Sign in to see your appointment.',
        ),
      ),
    );
  }

  void _showHelp() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => const SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(28, 8, 28, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Need a hand?',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 16),
              Text(
                'Use the same email and password as the patient website. '
                'If you are new, open the invitation from your clinic. '
                'If you have forgotten your password, contact your clinic for help.',
                style: TextStyle(fontSize: 16, height: 1.6),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final busy = widget.auth?.busy ?? false;
    final configured = widget.auth != null;
    return AuthFrame(
      children: [
        const BrandHeader(),
        const SizedBox(height: 44),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFE4F0EF),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Row(
            children: [
              Icon(Icons.favorite_outline_rounded, size: 17, color: primary),
              SizedBox(width: 10),
              Expanded(child: Text('A little closer to your care team')),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const Text(
          'Welcome back',
          style: TextStyle(
            color: ink,
            fontSize: 34,
            height: 1.15,
            fontWeight: FontWeight.w800,
            letterSpacing: -1,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'Your appointments, reports and care,\ntogether in one place.',
          style: TextStyle(color: muted, fontSize: 16, height: 1.6),
        ),
        const SizedBox(height: 30),
        ErrorNotice(widget.setupError ?? widget.auth?.error),
        Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
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
                autofillHints: const [
                  AutofillHints.username,
                  AutofillHints.email,
                ],
                validator: validateEmail,
              ),
              const SizedBox(height: 20),
              PasswordInput(
                controller: _password,
                enabled: !busy,
                validator: (value) => value == null || value.isEmpty
                    ? 'Enter your password.'
                    : null,
                onSubmitted: _submit,
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: busy ? null : _showHelp,
                  child: const Text('Need help signing in?'),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: configured && !busy ? _submit : null,
                child: buttonLabel('Sign in', busy),
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
        Row(
          children: [
            const Expanded(child: Divider(color: line)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'NEW HERE?',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: muted,
                  letterSpacing: 1.5,
                ),
              ),
            ),
            const Expanded(child: Divider(color: line)),
          ],
        ),
        const SizedBox(height: 16),
        FilledButton.tonalIcon(
          style: FilledButton.styleFrom(
            minimumSize: const Size(double.infinity, 54),
            backgroundColor: const Color(0xFFE4F0EF),
            foregroundColor: primary,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
          ),
          onPressed: configured && !busy ? _openSignup : null,
          icon: const Icon(Icons.person_add_outlined, size: 20),
          label: const Text(
            'Sign up for an account',
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(double.infinity, 54),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            side: const BorderSide(color: line),
          ),
          onPressed: configured && !busy ? _openInvite : null,
          icon: const Icon(Icons.mark_email_read_outlined, size: 20),
          label: const Text('I have a clinic invitation'),
        ),
        const SizedBox(height: 24),
        const Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.shield_outlined, size: 16, color: muted),
            SizedBox(width: 7),
            Flexible(
              child: Text(
                'For patients · Use your existing account',
                textAlign: TextAlign.center,
                style: TextStyle(color: muted, fontSize: 12),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
