import 'package:flutter/material.dart';
import '../../core/api_client.dart';

const communityGreen = Color(0xFF2C574C);
const communityBackground = Color(0xFFFBF9F6);
const communityInk = Color(0xFF192C26);
const communityMuted = Color(0xFF587067);
const communityBorder = Color(0xFFE6EFE9);
const communityMint = Color(0xFFEAF4EE);

class CommunitySurface extends StatelessWidget {
  const CommunitySurface({
    super.key,
    required this.child,
    this.color = Colors.white,
    this.padding = const EdgeInsets.all(18),
  });
  final Widget child;
  final Color color;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(22),
      border: Border.all(color: communityBorder),
      boxShadow: const [
        BoxShadow(
          color: Color(0x082C574C),
          blurRadius: 8,
          offset: Offset(0, 2),
        ),
      ],
    ),
    child: Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(22),
      child: Padding(padding: padding, child: child),
    ),
  );
}

class CommunityAvatar extends StatelessWidget {
  const CommunityAvatar({super.key, required this.username, this.size = 40});
  final String username;
  final double size;

  @override
  Widget build(BuildContext context) {
    const colors = [
      Color(0xFFFFE8D6),
      Color(0xFFE5EDFB),
      Color(0xFFF5EAFB),
      Color(0xFFD7EBE0),
    ];
    final index =
        username.codeUnits.fold(0, (sum, item) => sum + item) % colors.length;
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: colors[index],
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
        ),
        child: Text(
          username.isEmpty ? '?' : username.characters.first.toUpperCase(),
          style: TextStyle(
            fontSize: size * .35,
            color: communityGreen,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

class CommunityPill extends StatelessWidget {
  const CommunityPill(
    this.label, {
    super.key,
    this.icon,
    this.color = communityGreen,
    this.background = communityMint,
  });
  final String label;
  final IconData? icon;
  final Color color, background;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(10),
    ),
    child: Text.rich(
      TextSpan(
        children: [
          if (icon != null)
            WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Icon(icon, size: 12, color: color),
              ),
            ),
          TextSpan(text: label),
        ],
      ),
      style: TextStyle(
        fontSize: 11,
        height: 1.3,
        fontWeight: FontWeight.w600,
        color: color,
      ),
    ),
  );
}

class CommunityEmpty extends StatelessWidget {
  const CommunityEmpty({
    super.key,
    required this.icon,
    required this.title,
    required this.description,
    this.action,
  });
  final IconData icon;
  final String title, description;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 12),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: const BoxDecoration(
            color: communityMint,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: communityGreen, size: 30),
        ),
        const SizedBox(height: 18),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: communityInk,
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          description,
          textAlign: TextAlign.center,
          style: const TextStyle(color: communityMuted, height: 1.6),
        ),
        if (action != null)
          Padding(padding: const EdgeInsets.only(top: 18), child: action!),
      ],
    ),
  );
}

class CommunityPostCard extends StatelessWidget {
  const CommunityPostCard({
    super.key,
    required this.post,
    this.onOpen,
    this.onReport,
    this.expanded = false,
    this.showState = false,
    this.discussionOpen = false,
  });
  final Map<String, dynamic> post;
  final VoidCallback? onOpen, onReport;
  final bool expanded, showState, discussionOpen;

  static String publicationLabel(dynamic raw) {
    final time = raw is String ? DateTime.tryParse(raw) : null;
    if (time == null) return 'Community member';
    final age = DateTime.now().toUtc().difference(time.toUtc());
    if (age.inMinutes < 60) return 'Posted recently';
    if (age.inHours < 24) return 'About ${age.inHours}h ago';
    if (age.inDays == 1) return 'About a day ago';
    return 'About ${age.inDays} days ago';
  }

  @override
  Widget build(BuildContext context) {
    final username = post['username'] as String? ?? 'Community member';
    final tags = post['tags'] as List? ?? [];
    final badges = post['badges'] as List? ?? [];
    const roleLabels = {
      'doctor': 'Verified doctor',
      'therapist': 'Verified therapist',
      'moderator': 'Moderator',
      'peer_volunteer': 'Peer volunteer',
    };
    const stateLabels = {
      'normal': 'Awaiting publication',
      'pending': 'Pending review',
      'held': 'With the review team',
      'error': 'Review check needed',
      'published': 'Published',
      'superseded': 'Updated',
    };
    return CommunitySurface(
      padding: EdgeInsets.zero,
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(22),
        child: InkWell(
          onTap: onOpen,
          borderRadius: BorderRadius.circular(22),
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (tags.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      'r/${tags.first['name'] ?? 'health'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: communityGreen,
                        letterSpacing: -0.2,
                      ),
                    ),
                  ),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CommunityAvatar(username: username),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'u/$username',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: communityInk,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            publicationLabel(post['publishedAt']),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: communityMuted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (onReport != null)
                      IconButton(
                        tooltip: 'Report this post',
                        onPressed: onReport,
                        icon: const Icon(
                          Icons.more_horiz,
                          color: communityMuted,
                        ),
                        visualDensity: VisualDensity.compact,
                      ),
                  ],
                ),
                if (badges.any(roleLabels.containsKey))
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Wrap(
                      spacing: 5,
                      runSpacing: 5,
                      children: [
                        for (final badge in badges)
                          if (roleLabels.containsKey(badge))
                            CommunityPill(
                              roleLabels[badge]!,
                              icon: Icons.verified_outlined,
                            ),
                      ],
                    ),
                  ),
                const SizedBox(height: 14),
                Text(
                  post['title'] as String? ?? '',
                  maxLines: expanded ? null : 3,
                  overflow: expanded ? null : TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: expanded ? 22 : 16,
                    fontWeight: FontWeight.w700,
                    height: 1.4,
                    color: communityInk,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  post['body'] as String? ?? '',
                  maxLines: expanded ? null : 4,
                  overflow: expanded ? null : TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.65,
                    color: communityMuted,
                  ),
                ),
                if (tags.isNotEmpty || showState)
                  Padding(
                    padding: const EdgeInsets.only(top: 13),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final tag in tags)
                          CommunityPill(tag['name'] as String? ?? 'Topic'),
                        if (showState)
                          CommunityPill(
                            stateLabels[post['state']] ?? 'Under review',
                            icon: Icons.schedule_outlined,
                            color: const Color(0xFF8C6134),
                            background: const Color(0xFFFFF4E6),
                          ),
                      ],
                    ),
                  ),
                if (!expanded) ...[
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Divider(height: 1, color: communityBorder),
                  ),
                  Row(
                    children: [
                      // Reddit-style Upvote pill
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0F4F2),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.arrow_upward_rounded,
                              size: 15,
                              color: communityGreen,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '${((post['id']?.toString().hashCode ?? 1).abs() % 9) + 1}',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: communityInk,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Reddit-style Comments pill
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF0F4F2),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons.chat_bubble_outline_rounded,
                                size: 14,
                                color: communityGreen,
                              ),
                              const SizedBox(width: 6),
                              Flexible(
                                child: Text(
                                  showState
                                      ? 'Open post'
                                      : '${post['replyCount'] ?? 0} replies',
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: communityMuted,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  discussionOpen ? 'Hide discussion' : 'Read discussion',
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: communityGreen,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: const BoxDecoration(
                          color: Color(0xFFF0F4F2),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.arrow_forward_ios_rounded,
                          size: 11,
                          color: communityGreen,
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class CommunityUsernameDialog extends StatefulWidget {
  const CommunityUsernameDialog({
    super.key,
    required this.current,
    required this.onSave,
  });
  final String current;
  final Future<void> Function(String) onSave;
  @override
  State<CommunityUsernameDialog> createState() =>
      _CommunityUsernameDialogState();
}

class _CommunityUsernameDialogState extends State<CommunityUsernameDialog> {
  late final controller = TextEditingController(
    text: RegExp(r'^mother_[a-f0-9]{24}$').hasMatch(widget.current)
        ? ''
        : widget.current,
  );
  bool saving = false;
  String? error;
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final name = controller.text.trim().toLowerCase();
    if (!RegExp(r'^[a-z][a-z0-9_]{2,31}$').hasMatch(name) ||
        RegExp(r'[0-9]{7}').hasMatch(name) ||
        RegExp(
          r'^(admin|doctor|dr_|therapist|moderator|medbrief)',
        ).hasMatch(name)) {
      setState(
        () => error =
            'Use 3–32 letters, numbers or underscores, starting with a letter. Avoid phone numbers and staff titles.',
      );
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await widget.onSave(name);
      if (mounted) Navigator.pop(context, true);
    } on AppException catch (e) {
      if (mounted) {
        setState(() {
          saving = false;
          error = e.status == 409
              ? 'That username is unavailable. Choose another.'
              : e.status == 403
              ? 'Your username is locked. Refresh Community to see its current name.'
              : e.status == 401
              ? 'Please sign in again to change your username.'
              : 'Could not save your username. Your choice is still here; please try again.';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          saving = false;
          error = 'Could not save your username. Please try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      scrollable: true,
      title: const Text('Choose your community username'),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Pick a pseudonym, such as calm_garden. Avoid your real name, contact details or a username you use elsewhere. Once saved, it stays fixed until an approved identity reveal rotates it. You can then choose once again. All your posts and replies show your current name.',
          ),
          const SizedBox(height: 16),
          TextField(
            controller: controller,
            enabled: !saving,
            maxLength: 32,
            autocorrect: false,
            textCapitalization: TextCapitalization.none,
            decoration: const InputDecoration(
              labelText: 'Community username',
              hintText: 'calm_garden',
            ),
            onSubmitted: (_) {
              if (!saving) save();
            },
          ),
          if (error != null)
            Text(
              error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: saving ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: saving ? null : save,
          child: Text(saving ? 'Saving…' : 'Save username'),
        ),
      ],
    ),
  );
}

class CommunityComposer extends StatefulWidget {
  const CommunityComposer({
    super.key,
    required this.tags,
    required this.username,
    required this.onSubmit,
    this.existing,
  });
  final List<dynamic> tags;
  final String username;
  final Map<String, dynamic>? existing;
  final Future<void> Function(Map<String, dynamic>) onSubmit;

  @override
  State<CommunityComposer> createState() => _CommunityComposerState();
}

class _CommunityComposerState extends State<CommunityComposer> {
  late final title = TextEditingController(
    text: widget.existing?['title'] as String? ?? '',
  );
  late final body = TextEditingController(
    text: widget.existing?['body'] as String? ?? '',
  );
  late final selected = <String>{
    for (final tag in widget.existing?['tags'] as List? ?? [])
      tag['id'] as String,
  };
  bool sending = false;
  String? error;

  @override
  void dispose() {
    title.dispose();
    body.dispose();
    super.dispose();
  }

  Future<void> submit() async {
    if (sending || title.text.trim().isEmpty || body.text.trim().isEmpty) {
      return;
    }
    setState(() {
      sending = true;
      error = null;
    });
    try {
      await widget.onSubmit({
        'title': title.text.trim(),
        'body': body.text.trim(),
        'tags': selected.toList(),
        if (widget.existing != null) 'id': widget.existing!['id'],
      });
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (mounted) {
        setState(() {
          sending = false;
          error =
              'Your post could not be submitted. Your draft is still here. Please try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !sending,
    child: Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .88,
        ),
        padding: const EdgeInsets.fromLTRB(22, 12, 22, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: communityBorder,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.existing == null
                        ? 'Share with the community'
                        : 'Edit your post',
                    style: const TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w700,
                      color: communityInk,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Close composer',
                  onPressed: sending ? null : () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CommunityAvatar(username: widget.username, size: 34),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Posting as ${widget.username}',
                            style: const TextStyle(
                              color: communityMuted,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: title,
                      enabled: !sending,
                      maxLength: 200,
                      textCapitalization: TextCapitalization.sentences,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Title',
                        hintText: 'What would you like to talk about?',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: body,
                      enabled: !sending,
                      maxLength: 10000,
                      minLines: 4,
                      maxLines: 7,
                      textCapitalization: TextCapitalization.sentences,
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(
                        labelText: 'Your post',
                        hintText: 'Share your experience or ask a question…',
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (widget.tags.isNotEmpty) ...[
                      const Text(
                        'Add topics',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: communityInk,
                        ),
                      ),
                      const SizedBox(height: 7),
                      Wrap(
                        spacing: 6,
                        runSpacing: 5,
                        children: [
                          for (final tag in widget.tags)
                            FilterChip(
                              label: Text(tag['name'] as String),
                              selected: selected.contains(tag['id']),
                              onSelected:
                                  sending ||
                                      (selected.length >= 10 &&
                                          !selected.contains(tag['id']))
                                  ? null
                                  : (value) => setState(() {
                                      if (value) {
                                        selected.add(tag['id'] as String);
                                      } else {
                                        selected.remove(tag['id']);
                                      }
                                    }),
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],
                    const CommunitySurface(
                      color: communityMint,
                      padding: EdgeInsets.all(12),
                      child: Text(
                        'Keep names, phone numbers and locations out of your post. Posts and edits are screened before they appear.',
                        style: TextStyle(
                          color: communityMuted,
                          fontSize: 12,
                          height: 1.5,
                        ),
                      ),
                    ),
                    if (error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed:
                  sending ||
                      title.text.trim().isEmpty ||
                      body.text.trim().isEmpty
                  ? null
                  : submit,
              style: FilledButton.styleFrom(backgroundColor: communityGreen),
              icon: sending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_outlined, size: 18),
              label: Text(
                sending ? 'Checking your post…' : 'Submit for review',
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
