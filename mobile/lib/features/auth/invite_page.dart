import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import 'auth_repository.dart';
import 'auth_widgets.dart';

class InvitePage extends StatefulWidget {
  const InvitePage({super.key, required this.repository});
  final AuthRepository repository;

  @override
  State<InvitePage> createState() => _InvitePageState();
}

class _InvitePageState extends State<InvitePage> {
  final _link = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _form = GlobalKey<FormState>();
  AppointmentInvite? _invite;
  String? _token;
  String? _error;
  bool _busy = false;
  bool _accepted = false;

  @override
  void dispose() {
    _link.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _lookup() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final token = parseInviteToken(_link.text);
      final invite = await widget.repository.getInvite(token);
      if (!mounted) return;
      setState(() {
        _token = token;
        _invite = invite;
      });
      _link.clear();
    } catch (error) {
      if (mounted) setState(() => _error = authErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.acceptInvite(_token!, _password.text);
      if (!mounted) return;
      _password.clear();
      _confirm.clear();
      // Keep account creation separate from login: if the subsequent sign-in
      // fails, the patient is not asked to reuse an already-consumed invite.
      setState(() => _accepted = true);
    } catch (error) {
      if (mounted) setState(() => _error = authErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final invite = _invite;
    final canSignIn =
        invite != null &&
        (_accepted || invite.isUsed || invite.isReturningPatient);
    final unavailable = invite?.isExpired == true || invite?.isUsed == true;
    final scheduled = invite?.scheduledAt?.toLocal();
    return PopScope(
      canPop: !_busy,
      child: AuthFrame(
        showBack: true,
        children: [
          const BrandHeader(),
          const SizedBox(height: 32),
          Text(
            _accepted
                ? 'Your account is ready'
                : canSignIn
                ? 'Welcome back'
                : 'Your clinic invitation',
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          if (invite == null) ...[
            const Text(
              'Paste the invitation link sent by your clinic.',
              style: TextStyle(color: muted, height: 1.5),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _link,
              enabled: !_busy,
              autocorrect: false,
              enableSuggestions: false,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'Invitation link'),
            ),
            const SizedBox(height: 20),
            ErrorNotice(_error),
            FilledButton(
              onPressed: _busy ? null : _lookup,
              child: buttonLabel('Continue', _busy),
            ),
          ] else ...[
            if (invite.name.isNotEmpty)
              Text(
                invite.name,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
            const SizedBox(height: 8),
            Text(invite.email, style: const TextStyle(color: muted)),
            if (scheduled != null) ...[
              const SizedBox(height: 12),
              Text(MaterialLocalizations.of(context).formatFullDate(scheduled)),
              Text(
                MaterialLocalizations.of(
                  context,
                ).formatTimeOfDay(TimeOfDay.fromDateTime(scheduled)),
              ),
            ],
            const SizedBox(height: 24),
            if (canSignIn) ...[
              Text(
                _accepted
                    ? 'Sign in with the password you just created.'
                    : 'Use your existing password. An invitation does not change it.',
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => Navigator.pop(context, invite.email),
                child: const Text('Go to sign in'),
              ),
            ] else if (unavailable) ...[
              const ErrorNotice(
                'This invitation has expired. Ask your clinic for a new link.',
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Back to sign in'),
              ),
            ] else ...[
              const Text(
                'Choose a password to finish setting up your account.',
              ),
              const SizedBox(height: 24),
              Form(
                key: _form,
                child: Column(
                  children: [
                    PasswordInput(
                      controller: _password,
                      newPassword: true,
                      enabled: !_busy,
                      validator: (value) => value == null || value.length < 8
                          ? 'Use at least 8 characters.'
                          : null,
                    ),
                    const SizedBox(height: 20),
                    PasswordInput(
                      controller: _confirm,
                      label: 'Confirm password',
                      newPassword: true,
                      enabled: !_busy,
                      validator: (value) => value != _password.text
                          ? 'The two passwords do not match.'
                          : null,
                      onSubmitted: _accept,
                    ),
                    const SizedBox(height: 24),
                    ErrorNotice(_error),
                    FilledButton(
                      onPressed: _busy ? null : _accept,
                      child: buttonLabel('Create my account', _busy),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
