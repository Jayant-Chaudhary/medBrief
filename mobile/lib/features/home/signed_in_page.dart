import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../core/api_client.dart';
import '../community/community_page.dart';
import '../community/community_push.dart';
import '../community/community_repository.dart';
import '../auth/auth_controller.dart';
import '../auth/auth_widgets.dart';

class SignedInPage extends StatefulWidget {
  const SignedInPage({super.key, required this.auth, this.api, this.push});
  final AuthController auth;
  final ApiClient? api;
  final CommunityPush? push;
  @override
  State<SignedInPage> createState() => _SignedInPageState();
}

class _SignedInPageState extends State<SignedInPage> {
  bool communityOpen = false;
  AuthController get auth => widget.auth;
  @override
  void initState() {
    super.initState();
    widget.push?.inboxRequests.addListener(_openInbox);
  }

  void _openInbox() {
    if (mounted) setState(() => communityOpen = true);
  }

  @override
  void dispose() {
    widget.push?.inboxRequests.removeListener(_openInbox);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => communityOpen && widget.api != null
      ? Scaffold(
          body: SafeArea(
            child: Column(
              children: [
                TextButton(
                  onPressed: () => setState(() => communityOpen = false),
                  child: const Text('Back to my account'),
                ),
                Expanded(
                  child: Navigator(
                    onGenerateRoute: (_) => MaterialPageRoute<void>(
                      builder: (_) => CommunityPage(
                        repository: CommunityRepository(widget.api!),
                        push: widget.push,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        )
      : AuthFrame(
          children: [
            const BrandHeader(),
            const SizedBox(height: 40),
            const Icon(
              Icons.check_circle_outline_rounded,
              color: primary,
              size: 60,
            ),
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
            if (widget.api != null)
              FilledButton(
                onPressed: () => setState(() => communityOpen = true),
                child: const Text('Open community'),
              ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: auth.busy ? null : auth.signOut,
              child: const Text('Sign out'),
            ),
          ],
        );
}
