import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import 'community_repository.dart';
import 'community_push.dart';
import 'community_widgets.dart';

class CommunityPage extends StatefulWidget {
  const CommunityPage({
    super.key,
    required this.repository,
    this.push,
    this.onExit,
    this.initialInbox = false,
  });
  final CommunityRepository repository;
  final CommunityPush? push;
  final VoidCallback? onExit;
  final bool initialInbox;
  @override
  State<CommunityPage> createState() => _CommunityPageState();
}

class _CommunityPageState extends State<CommunityPage> {
  Map<String, dynamic>? notice, member, post, conversation;
  List<dynamic> tags = [],
      posts = [],
      comments = [],
      threads = [],
      messages = [];
  final Map<String, List<dynamic>> replies = {};
  final Set<String> collapsedComments = {};
  final Set<String> upvotedIds = {};
  String? selectedTag, error;
  String search = '';
  final searchController = TextEditingController();
  final replyController = TextEditingController();
  String? replyParentId;
  bool replyEditorVisible = false;
  bool busy = false, inbox = false, available = true, ownPosts = false;
  bool canChooseUsername = false;
  Timer? poll;
  CommunityRepository get repo => widget.repository;

  @override
  void initState() {
    super.initState();
    widget.push?.inboxRequests.addListener(openInboxFromPush);
    unawaited(start());
  }

  @override
  void dispose() {
    poll?.cancel();
    searchController.dispose();
    replyController.dispose();
    widget.push?.inboxRequests.removeListener(openInboxFromPush);
    super.dispose();
  }

  void openInboxFromPush() {
    if (mounted && member != null) {
      unawaited(
        run(() async {
          setState(() {
            post = null;
            conversation = null;
          });
          await loadInbox();
        }),
      );
    }
  }

  Future<void> run(Future<void> Function() task) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await task();
    } on AppException catch (e) {
      if (mounted) {
        setState(
          () => error = e.status == 503
              ? 'Community is currently unavailable. Please contact your clinic directly if you need support.'
              : e.message,
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error = 'Could not complete this request. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> start() => run(() async {
    final n = Map<String, dynamic>.from(await repo.get('/notice'));
    if (!mounted) return;
    setState(() {
      notice = n;
      available = n['enabled'] == true;
    });
    if (!available) return;
    try {
      final me = Map<String, dynamic>.from(await repo.get('/me'));
      if (!mounted) return;
      setState(() => member = me);
      await loadUsernameStatus();
      await loadFeed();
      if (widget.initialInbox) {
        await loadInbox();
      }
    } on AppException catch (e) {
      if (e.status != 403) rethrow;
    }
  });
  Future<void> loadFeed({bool more = false}) async {
    final query = <String, String>{};
    if (selectedTag != null) query['tag'] = selectedTag!;
    if (more && posts.isNotEmpty) query['before'] = posts.last['id'] as String;
    final suffix = query.isEmpty ? '' : '?${Uri(queryParameters: query).query}';
    final fetchedTags = await repo.get('/tags') as List;
    final fetchedPosts =
        await repo.get(ownPosts ? '/posts/mine' : '/posts$suffix') as List;
    if (mounted) {
      setState(() {
        tags = fetchedTags;
        posts = more ? [...posts, ...fetchedPosts] : fetchedPosts;
      });
    }
  }

  Future<void> loadThread(Map<String, dynamic> value) async {
    if (post?['id'] != value['id']) clearReplyDraft();
    if (ownPosts && value['state'] != null && value['state'] != 'published') {
      if (mounted) {
        setState(() {
          post = value;
          comments = [];
          replies.clear();
          collapsedComments.clear();
        });
      }
      return;
    }
    final fresh = await repo.get('/posts/${value['id']}') as List;
    if (fresh.isEmpty) {
      throw const AppException('This post is no longer available.');
    }
    final list = await repo.get('/posts/${value['id']}/comments') as List;
    if (mounted) {
      setState(() {
        post = Map<String, dynamic>.from(fresh.first);
        comments = list;
        replies.clear();
        collapsedComments.clear();
      });
    }
  }

  Future<void> toggleThread(Map<String, dynamic> value) async {
    if (post?['id'] == value['id']) {
      setState(() {
        clearReplyDraft();
        post = null;
        comments = [];
        replies.clear();
        collapsedComments.clear();
      });
      return;
    }
    await run(() => loadThread(value));
  }

  Future<void> loadUsernameStatus() async {
    bool allowed = false;
    try {
      final status = await repo.get('/username/status');
      allowed = status is Map && status['canChooseUsername'] == true;
    } catch (_) {
      // A missing migration or failed status check must never unlock a name.
    }
    if (mounted) setState(() => canChooseUsername = allowed);
  }

  Future<void> chooseUsername() async {
    if (!canChooseUsername) return;
    final changed = await showDialog<bool>(
      context: context,
      useRootNavigator: false,
      barrierDismissible: false,
      builder: (_) => CommunityUsernameDialog(
        current: member!['username'] as String,
        onSave: (name) async {
          await repo.send('/username', {'username': name});
        },
      ),
    );
    if (changed != true || !mounted) return;
    await run(() async {
      final me = Map<String, dynamic>.from(await repo.get('/me'));
      if (!mounted) return;
      setState(() => member = me);
      await loadUsernameStatus();
      await loadFeed();
      if (post != null) await loadThread(post!);
    });
  }

  Future<void> loadInbox() async {
    final list = await repo.get('/care/threads') as List;
    if (mounted) {
      setState(() {
        inbox = true;
        threads = list;
      });
    }
  }

  Future<void> openConversation(Map<String, dynamic> value) async {
    final list =
        await repo.get('/care/threads/${value['id']}/messages') as List;
    if (!mounted) return;
    setState(() {
      conversation = value;
      messages = list;
    });
    if (value['closed'] != true &&
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
      await repo.send('/care/respond', {'id': value['id'], 'kind': 'opened'});
    }
    poll?.cancel();
    poll = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!mounted ||
          busy ||
          conversation == null ||
          WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
        return;
      }
      unawaited(
        run(() async {
          final list =
              await repo.get('/care/threads/${conversation!['id']}/messages')
                  as List;
          if (mounted) setState(() => messages = list);
        }),
      );
    });
  }

  Future<String?> textDialog(String title, {String initial = ''}) async {
    final controller = TextEditingController(text: initial);
    final value = await showDialog<String>(
      context: context,
      useRootNavigator: false,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          maxLines: 6,
          maxLength: 10000,
          decoration: const InputDecoration(
            hintText: 'Avoid names, phone numbers and locations.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                Navigator.pop(context, controller.text.trim());
              }
            },
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    // Wait for the closing dialog's transition before disposing its controller.
    Future<void>.delayed(const Duration(milliseconds: 400), controller.dispose);
    return value;
  }

  Future<void> composePost({Map<String, dynamic>? existing}) async {
    final submitted = await showModalBottomSheet<bool>(
      context: context,
      useRootNavigator: false,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: communityBackground,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (_) => CommunityComposer(
        tags: tags,
        username: member!['username'] as String,
        existing: existing,
        onSubmit: (data) async {
          await repo.send(existing == null ? '/posts' : '/posts/edit', data);
        },
      ),
    );
    if (submitted != true || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Submitted. You can follow its status in My posts.'),
      ),
    );
    await run(() async {
      if (post != null && existing != null) setState(() => post = null);
      await loadFeed();
    });
  }

  Future<void> reply({
    Map<String, dynamic>? parent,
    Map<String, dynamic>? edit,
  }) async {
    if (edit == null) {
      setState(() {
        if (replyParentId != parent?['id']) replyController.clear();
        replyParentId = parent?['id'] as String?;
        replyEditorVisible = true;
      });
      return;
    }
    final text = await textDialog(
      'Edit reply',
      initial: edit['body'] as String? ?? '',
    );
    if (text == null || !mounted) return;
    await run(() async {
      await repo.send('/comments/edit', {'id': edit['id'], 'body': text});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reply submitted for review.')),
        );
      }
      await loadThread(post!);
    });
  }

  void clearReplyDraft() {
    replyController.clear();
    replyParentId = null;
    replyEditorVisible = false;
  }

  Future<void> submitInlineReply() async {
    final text = replyController.text.trim();
    if (text.isEmpty || post == null) return;
    await run(() async {
      await repo.send('/comments', {
        'postId': post!['id'],
        'parentId': replyParentId,
        'body': text,
      });
      if (!mounted) return;
      setState(clearReplyDraft);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Reply submitted for review.')),
      );
      await loadThread(post!);
    });
  }

  Widget inlineReplyEditor() => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: replyController,
          enabled: !busy,
          minLines: 2,
          maxLines: 5,
          maxLength: 10000,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: 'Your reply',
            hintText: 'Share kindly. Avoid identifying details.',
          ),
        ),
        Wrap(
          spacing: 8,
          children: [
            FilledButton(
              onPressed: busy || replyController.text.trim().isEmpty
                  ? null
                  : submitInlineReply,
              child: const Text('Send reply'),
            ),
            TextButton(
              onPressed: busy ? null : () => setState(clearReplyDraft),
              child: const Text('Cancel reply'),
            ),
          ],
        ),
      ],
    ),
  );

  Future<void> report(Map<String, dynamic> item, String type) async {
    final category = await showDialog<String>(
      context: context,
      useRootNavigator: false,
      builder: (context) => SimpleDialog(
        title: const Text('Report a concern'),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, 'worried'),
            child: const Text("I'm worried about this person"),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, 'abuse'),
            child: const Text('This is abusive or inappropriate'),
          ),
        ],
      ),
    );
    if (category == null || !mounted) return;
    await run(() async {
      await repo.send('/reports', {
        'id': item['id'],
        'targetType': type,
        'category': category,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Your report has been received.')),
        );
      }
    });
  }

  Future<void> refresh() async {
    if (member == null) {
      await start();
      return;
    }
    await run(() async {
      await loadUsernameStatus();
      if (conversation != null) {
        final list =
            await repo.get('/care/threads/${conversation!['id']}/messages')
                as List;
        if (mounted) setState(() => messages = list);
      } else if (post != null) {
        await loadThread(post!);
      } else if (inbox) {
        await loadInbox();
      } else {
        await loadFeed();
      }
    });
  }

  void goBack() {
    clearReplyDraft();
    if (post != null && conversation == null) {
      setState(() {
        post = null;
        comments = [];
        replies.clear();
        collapsedComments.clear();
      });
      return;
    }
    if (post != null || conversation != null) {
      poll?.cancel();
      setState(() {
        post = null;
        conversation = null;
        messages = [];
      });
      unawaited(run(inbox ? loadInbox : loadFeed));
    } else if (widget.onExit != null) {
      widget.onExit!();
    } else if (Navigator.canPop(context)) {
      Navigator.pop(context);
    }
  }

  Future<void> selectSection(int section) async {
    await run(() async {
      poll?.cancel();
      setState(() {
        clearReplyDraft();
        post = null;
        conversation = null;
        messages = [];
        inbox = section == 1;
        ownPosts = section == 2;
      });
      if (inbox) {
        await loadInbox();
      } else {
        await loadFeed();
      }
    });
  }

  Future<void> removeItem(Map<String, dynamic> item, String type) async {
    final confirmed = await showDialog<bool>(
      context: context,
      useRootNavigator: false,
      builder: (context) => AlertDialog(
        title: Text('Remove this $type?'),
        content: const Text(
          'It will no longer appear in the community. Relevant safety records may still be retained.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await run(() async {
      await repo.send(type == 'post' ? '/posts/remove' : '/comments/remove', {
        'id': item['id'],
      });
      if (type == 'post') {
        if (mounted) setState(() => post = null);
        await loadFeed();
      } else {
        await loadThread(post!);
      }
    });
  }

  Widget commentCard(Map<String, dynamic> value, [int depth = 0]) {
    final commentId = value['id'] as String;
    final isUpvoted = upvotedIds.contains(commentId);
    final baseVotes = ((commentId.hashCode).abs() % 7) + 1;
    final votes = baseVotes + (isUpvoted ? 1 : 0);

    return Padding(
      padding: EdgeInsets.only(left: depth > 0 && depth < 4 ? 12 : 0, top: 10),
      child: Container(
        padding: EdgeInsets.only(left: depth < 4 ? 12 : 4),
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(
              color: depth > 0 ? const Color(0xFFC7DDD0) : communityBorder,
              width: 2,
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CommunityAvatar(
                  username: value['username'] as String? ?? '',
                  size: 26,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'u/${value['username'] as String? ?? 'Removed'}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: communityInk,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: collapsedComments.contains(value['id'])
                      ? 'Expand thread'
                      : 'Collapse thread',
                  onPressed: () => setState(() {
                    final id = value['id'] as String;
                    if (!collapsedComments.add(id)) collapsedComments.remove(id);
                  }),
                  icon: Icon(
                    collapsedComments.contains(value['id'])
                        ? Icons.add_circle_outline
                        : Icons.remove_circle_outline,
                    size: 18,
                    color: communityMuted,
                  ),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            if (collapsedComments.contains(value['id']))
              Container(
                margin: const EdgeInsets.symmetric(vertical: 6),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: communityMint,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text(
                  'Thread collapsed',
                  style: TextStyle(
                    color: communityMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              )
            else ...[
              const SizedBox(height: 7),
              Text(
                value['body'] as String? ?? '',
                style: const TextStyle(
                  color: communityInk,
                  height: 1.55,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 4),
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 6,
                children: [
                  // Reddit-style mini upvote for comment
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        if (!upvotedIds.add(commentId)) {
                          upvotedIds.remove(commentId);
                        }
                      });
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.arrow_upward_rounded,
                            size: 14,
                            color: isUpvoted ? communityGreen : communityMuted,
                          ),
                          const SizedBox(width: 3),
                          Text(
                            '$votes',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: isUpvoted ? communityGreen : communityMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: busy ? null : () => reply(parent: value),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                    child: const Text('Reply', style: TextStyle(fontSize: 12)),
                  ),
                  if (value['removed'] != true)
                    TextButton(
                      onPressed: busy ? null : () => report(value, 'comment'),
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      child: const Text('Report', style: TextStyle(fontSize: 12)),
                    ),
                  if (value['owned'] == true && value['removed'] != true) ...[
                    TextButton(
                      onPressed: busy ? null : () => reply(edit: value),
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      child: const Text('Edit', style: TextStyle(fontSize: 12)),
                    ),
                    TextButton(
                      onPressed: busy ? null : () => removeItem(value, 'comment'),
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      child: const Text('Remove', style: TextStyle(fontSize: 12)),
                    ),
                  ],
                  if (value['hasReplies'] == true)
                    TextButton(
                      onPressed: busy
                          ? null
                          : () => run(() async {
                              if (replies.containsKey(value['id'])) {
                                setState(() => replies.remove(value['id']));
                                return;
                              }
                              final list = await repo.get(
                                '/posts/${post!['id']}/comments?parentId=${value['id']}',
                              ) as List;
                              if (mounted) {
                                setState(
                                  () => replies[value['id'] as String] = list,
                                );
                              }
                            }),
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      child: Text(
                        replies.containsKey(value['id'])
                            ? 'Hide replies'
                            : 'Show replies',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                      ),
                    ),
                ],
              ),
              if (replyEditorVisible && replyParentId == value['id'])
                inlineReplyEditor(),
              for (final child in replies[value['id']] ?? [])
                commentCard(Map<String, dynamic>.from(child), depth + 1),
              if ((replies[value['id']]?.length ?? 0) >= 20)
                TextButton(
                  onPressed: busy
                      ? null
                      : () => run(() async {
                          final loaded = replies[value['id']]!;
                          final more = await repo.get(
                            '/posts/${post!['id']}/comments?parentId=${value['id']}&before=${loaded.last['id']}',
                          ) as List;
                          if (mounted) setState(() => loaded.addAll(more));
                        }),
                  child: const Text('More replies'),
                ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final detail = conversation != null || post != null;
    return PopScope(
      canPop: !detail,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) goBack();
      },
      child: Scaffold(
        backgroundColor: communityBackground,
        appBar: AppBar(
          backgroundColor: communityBackground,
          surfaceTintColor: Colors.transparent,
          toolbarHeight: 76,
          leadingWidth: 58,
          leading: detail || widget.onExit != null || Navigator.canPop(context)
              ? Padding(
                  padding: const EdgeInsets.only(left: 14),
                  child: Center(
                    child: SizedBox.square(
                      dimension: 42,
                      child: IconButton(
                        tooltip: detail
                            ? 'Back to community'
                            : 'Back to Home',
                        onPressed: busy ? null : goBack,
                        style: IconButton.styleFrom(
                          backgroundColor: Colors.white,
                          side: const BorderSide(color: communityBorder),
                          shape: const CircleBorder(),
                        ),
                        icon: const Icon(
                          Icons.chevron_left_rounded,
                          color: communityGreen,
                        ),
                      ),
                    ),
                  ),
                )
              : null,
          titleSpacing: 8,
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                conversation != null ? 'Care conversation' : 'Community',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: communityInk,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                conversation != null
                    ? 'Private support, in your own space'
                    : post != null
                        ? 'Discussion · r/${(post!['tags'] as List?)?.firstOrNull?['name'] ?? 'general'}'
                        : 'A little support, a shared journey',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: communityMuted),
              ),
            ],
          ),
          actions: [
            IconButton(
              tooltip: 'Refresh',
              onPressed: busy ? null : refresh,
              icon: const Icon(
                Icons.refresh_rounded,
                size: 21,
                color: communityGreen,
              ),
            ),
            if (member != null)
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: IconButton(
                  tooltip: canChooseUsername
                      ? 'Choose community username'
                      : 'Community username locked',
                  onPressed: busy || !canChooseUsername ? null : chooseUsername,
                  icon: CommunityAvatar(
                    username: member!['username'] as String,
                    size: 36,
                  ),
                ),
              ),
          ],
          bottom: const PreferredSize(
            preferredSize: Size.fromHeight(1),
            child: Divider(height: 1, color: communityBorder),
          ),
        ),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Column(
              children: [
                if (busy)
                  const LinearProgressIndicator(
                    minHeight: 2,
                    color: communityGreen,
                    backgroundColor: communityMint,
                  ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: CommunitySurface(
                      color: const Color(0xFFFFF4EC),
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline_rounded,
                            size: 19,
                            color: Color(0xFF9E543B),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              error!,
                              style: const TextStyle(
                                color: Color(0xFF9E543B),
                                fontSize: 12,
                                height: 1.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (member != null && !detail)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: sectionTabs(),
                  ),
                Expanded(child: buildContent()),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget sectionTabs() => Container(
    padding: const EdgeInsets.all(4),
    decoration: BoxDecoration(
      color: const Color(0xFFF0F0E9),
      borderRadius: BorderRadius.circular(16),
    ),
    child: Row(
      children: [
        for (final item in [
          (0, 'Feed', Icons.view_agenda_outlined),
          (1, 'Care inbox', Icons.chat_bubble_outline_rounded),
          (2, 'My posts', Icons.edit_note_rounded),
        ])
          Expanded(
            child: Semantics(
              selected:
                  (inbox
                      ? 1
                      : ownPosts
                      ? 2
                      : 0) ==
                  item.$1,
              child: TextButton(
                onPressed: busy ? null : () => selectSection(item.$1),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 3,
                    vertical: 10,
                  ),
                  foregroundColor: communityGreen,
                  backgroundColor:
                      (inbox
                              ? 1
                              : ownPosts
                              ? 2
                              : 0) ==
                          item.$1
                      ? Colors.white
                      : Colors.transparent,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(item.$3, size: 18),
                    const SizedBox(height: 4),
                    Text(
                      item.$2,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    ),
  );

  Widget scrolling(List<Widget> children, {Key? key}) => RefreshIndicator(
    onRefresh: refresh,
    color: communityGreen,
    child: ListView(
      key: key,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      physics: const AlwaysScrollableScrollPhysics(),
      children: children,
    ),
  );

  Widget buildContent() {
    if (notice == null) {
      return scrolling([
        CommunityEmpty(
          icon: Icons.forum_outlined,
          title: busy ? 'Opening your community…' : 'Let’s reconnect',
          description: busy
              ? 'Getting your community ready.'
              : 'Refresh to connect to your community again.',
          action: busy
              ? null
              : OutlinedButton.icon(
                  onPressed: start,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Retry'),
                ),
        ),
      ]);
    }
    if (!available) {
      return scrolling([
        const CommunityEmpty(
          icon: Icons.spa_outlined,
          title: 'A space for support',
          description:
              'Community support is not available yet. Contact your clinic directly for help.',
        ),
      ]);
    }
    if (member == null) return consentContent();
    if (conversation != null) return conversationContent();
    if (post != null) return discussionContent();
    if (inbox) return inboxContent();
    return feedContent();
  }

  Widget consentContent() => scrolling([
    const CommunityEmpty(
      icon: Icons.favorite_border_rounded,
      title: 'You belong here',
      description:
          'Connect, share experiences and find support through every part of your journey.',
    ),
    CommunitySurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CommunityPill('Before you join', icon: Icons.shield_outlined),
          const SizedBox(height: 16),
          const Text(
            'Your privacy matters',
            style: TextStyle(
              fontSize: 21,
              color: communityInk,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            notice!['text'] as String,
            style: const TextStyle(color: communityMuted, height: 1.7),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: busy
                ? null
                : () => run(() async {
                    await repo.enrol(notice!['version'] as String);
                    final me = Map<String, dynamic>.from(await repo.get('/me'));
                    if (mounted) setState(() => member = me);
                    await loadUsernameStatus();
                    if (widget.initialInbox) {
                      await loadInbox();
                    } else {
                      await loadFeed();
                    }
                  }),
            style: FilledButton.styleFrom(backgroundColor: communityGreen),
            child: const Text('I understand and agree'),
          ),
        ],
      ),
    ),
  ]);

  List<Map<String, dynamic>> get visiblePosts {
    final query = search.trim().toLowerCase();
    return posts.map((p) => Map<String, dynamic>.from(p)).where((p) {
      if (ownPosts &&
          selectedTag != null &&
          !(p['tags'] as List? ?? []).any((t) => t['id'] == selectedTag)) {
        return false;
      }
      return query.isEmpty ||
          [
            p['title'],
            p['body'],
            p['username'],
            ...[for (final tag in p['tags'] as List? ?? []) tag['name']],
          ].whereType<String>().join(' ').toLowerCase().contains(query);
    }).toList();
  }

  Widget feedContent() {
    final visible = visiblePosts;
    return scrolling([
      TextField(
        controller: searchController,
        onChanged: (value) => setState(() => search = value),
        decoration: InputDecoration(
          hintText: 'Search loaded posts and topics…',
          hintStyle: const TextStyle(color: communityMuted, fontSize: 13),
          prefixIcon: const Icon(
            Icons.search_rounded,
            color: communityMuted,
            size: 21,
          ),
          suffixIcon: search.isEmpty
              ? null
              : IconButton(
                  tooltip: 'Clear search',
                  onPressed: () {
                    searchController.clear();
                    setState(() => search = '');
                  },
                  icon: const Icon(Icons.close_rounded, size: 18),
                ),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 15,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: const BorderSide(color: communityBorder),
          ),
        ),
      ),
      const SizedBox(height: 12),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            topicChip('All Posts', null),
            for (final tag in tags)
              topicChip(tag['name'] as String, tag['id'] as String),
          ],
        ),
      ),
      const SizedBox(height: 14),
      CommunitySurface(
        color: communityMint,
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            const Icon(Icons.forum_outlined, color: communityGreen, size: 27),
            const SizedBox(width: 11),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Something on your mind?',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: communityInk,
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'Share with your community username.',
                    style: TextStyle(
                      fontSize: 11,
                      color: communityMuted,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: busy ? null : () => composePost(),
              style: FilledButton.styleFrom(
                backgroundColor: communityGreen,
                minimumSize: const Size(0, 42),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(13),
                ),
              ),
              child: const Text(
                '+ Ask',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 14),
      Row(
        children: [
          const Icon(Icons.shield_outlined, color: communityMuted, size: 14),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              canChooseUsername &&
                      RegExp(
                        r'^mother_[a-f0-9]{24}$',
                      ).hasMatch(member!['username'] as String)
                  ? 'Pick your community username'
                  : 'Posting as ${member!['username']}',
              style: const TextStyle(color: communityMuted, fontSize: 11),
            ),
          ),
          const SizedBox(width: 6),
          if (canChooseUsername)
            TextButton(
              onPressed: busy ? null : chooseUsername,
              child: const Text(
                'Choose username',
                style: TextStyle(fontSize: 11),
              ),
            ),
          if (!canChooseUsername)
            const CommunityPill('Username locked', icon: Icons.lock_outline),
        ],
      ),
      const SizedBox(height: 16),
      if (ownPosts)
        const Padding(
          padding: EdgeInsets.only(bottom: 14),
          child: Text(
            'Your posts, including those waiting for review. Only you can see your unpublished posts.',
            style: TextStyle(color: communityMuted, fontSize: 12, height: 1.5),
          ),
        ),
      if (search.trim().isNotEmpty)
        const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: Text(
            'Search applies to posts loaded here. Load more to search older posts.',
            style: TextStyle(fontSize: 11, color: communityMuted),
          ),
        ),
      if (visible.isEmpty)
        CommunityEmpty(
          icon: search.isEmpty
              ? Icons.chat_bubble_outline_rounded
              : Icons.search_off_rounded,
          title: search.isNotEmpty
              ? 'No matching posts'
              : ownPosts
              ? 'Your voice belongs here'
              : 'Start a conversation',
          description: search.isNotEmpty
              ? 'Try another word or clear the topic filter.'
              : ownPosts
              ? 'Your shared posts and review status will appear here.'
              : 'No published posts yet. Share an experience or ask the community a question.',
        ),
      for (final value in visible)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: CommunityPostCard(
            post: value,
            showState: ownPosts,
            discussionOpen: false,
            onOpen: busy ? null : () => toggleThread(value),
            onReport: busy || ownPosts ? null : () => report(value, 'post'),
          ),
        ),
      if (!ownPosts && posts.length >= 20)
        OutlinedButton(
          onPressed: busy ? null : () => run(() => loadFeed(more: true)),
          child: const Text('More posts'),
        ),
    ]);
  }

  Widget topicChip(String label, String? id) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: ChoiceChip(
      label: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          color: selectedTag == id ? Colors.white : communityGreen,
        ),
      ),
      selected: selectedTag == id,
      showCheckmark: false,
      selectedColor: communityGreen,
      backgroundColor: Colors.white,
      side: BorderSide(
        color: selectedTag == id ? communityGreen : communityBorder,
      ),
      shape: const StadiumBorder(),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      onSelected: busy
          ? null
          : (_) => run(() async {
              setState(() => selectedTag = id);
              await loadFeed();
            }),
    ),
  );

  Widget discussionContent() {
    final pending = post!['state'] != null && post!['state'] != 'published';

    return scrolling([
      // Top Navigation / Return bar
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          TextButton.icon(
            onPressed: busy ? null : goBack,
            icon: const Icon(Icons.arrow_back_rounded, size: 18),
            label: const Text('Back to feed'),
            style: TextButton.styleFrom(foregroundColor: communityGreen),
          ),
          IconButton(
            tooltip: 'Close discussion',
            onPressed: busy ? null : goBack,
            icon: const Icon(Icons.close_rounded, size: 20, color: communityMuted),
          ),
        ],
      ),
      const SizedBox(height: 6),

      // Post Card in Discussion
      CommunityPostCard(
        post: post!,
        showState: ownPosts,
        discussionOpen: true,
        onOpen: busy ? null : goBack,
        onReport: busy || ownPosts ? null : () => report(post!, 'post'),
      ),
      const SizedBox(height: 12),

      // Discussion & Comments Section
      CommunitySurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Discussion',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: communityInk,
                    fontSize: 18,
                  ),
                ),
                Text(
                  '${comments.length} comments',
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    color: communityMuted,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            const Text(
              'Be kind. Share experiences, and leave medical decisions to the care team.',
              style: TextStyle(
                fontSize: 12,
                height: 1.5,
                color: communityMuted,
              ),
            ),
            const SizedBox(height: 14),

            if (pending)
              const CommunitySurface(
                color: communityMint,
                child: Text(
                  'Your post is being checked. Replies will be available after publication.',
                  style: TextStyle(color: communityMuted, height: 1.6),
                ),
              ),

            if (post!['owned'] == true) ...[
              Wrap(
                spacing: 8,
                children: [
                  TextButton.icon(
                    onPressed: busy ? null : () => composePost(existing: post),
                    icon: const Icon(Icons.edit_outlined, size: 16),
                    label: const Text('Edit'),
                  ),
                  TextButton.icon(
                    onPressed: busy ? null : () => removeItem(post!, 'post'),
                    icon: const Icon(Icons.delete_outline_rounded, size: 16),
                    label: const Text('Remove'),
                  ),
                  TextButton.icon(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            await repo.send('/help', {
                              'id': post!['id'],
                              'targetType': 'post',
                            });
                            if (mounted) setState(() => post = null);
                            await loadInbox();
                          }),
                    icon: const Icon(Icons.support_agent_outlined, size: 16),
                    label: const Text('I need help now'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
            ],

            if (!pending) ...[
              FilledButton.icon(
                onPressed: busy ? null : () => reply(),
                style: FilledButton.styleFrom(backgroundColor: communityGreen),
                icon: const Icon(Icons.chat_bubble_outline_rounded, size: 18),
                label: const Text('Write a reply'),
              ),
              if (replyEditorVisible && replyParentId == null)
                inlineReplyEditor(),
              const SizedBox(height: 16),
              if (comments.isEmpty)
                const CommunityEmpty(
                  icon: Icons.chat_outlined,
                  title: 'Be the first to reply',
                  description:
                      'A thoughtful reply can make someone feel less alone.',
                ),
              for (final value in comments)
                commentCard(Map<String, dynamic>.from(value)),
              if (comments.length >= 20)
                TextButton(
                  onPressed: busy
                      ? null
                      : () => run(() async {
                          final more = await repo.get(
                            '/posts/${post!['id']}/comments?before=${comments.last['id']}',
                          ) as List;
                          if (mounted) setState(() => comments.addAll(more));
                        }),
                  child: const Text('More comments'),
                ),
            ],
          ],
        ),
      ),
    ], key: const PageStorageKey('discussion_scroll'));
  }

  Widget notificationSetting() => widget.push == null
      ? const SizedBox.shrink()
      : CommunitySurface(
          padding: const EdgeInsets.all(4),
          child: ValueListenableBuilder<bool>(
            valueListenable: widget.push!.enabled,
            builder: (context, value, _) => SwitchListTile(
              title: const Text(
                'Generic message notifications',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: communityInk,
                ),
              ),
              subtitle: const Text(
                'Notification previews never include your messages.',
                style: TextStyle(fontSize: 11, color: communityMuted),
              ),
              activeThumbColor: communityGreen,
              value: value,
              onChanged: busy
                  ? null
                  : (enable) => run(() async {
                      if (enable) {
                        final ok = await widget.push!.enable();
                        if (!ok && mounted) {
                          setState(
                            () => error =
                                'Notifications are unavailable or permission was declined. You can still check your Care inbox.',
                          );
                        }
                      } else {
                        await widget.push!.disable();
                      }
                    }),
            ),
          ),
        );

  Widget inboxContent() => scrolling([
    const CommunitySurface(
      color: communityMint,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CommunityPill(
            'Private care',
            icon: Icons.lock_outline_rounded,
            background: Colors.white,
          ),
          SizedBox(height: 12),
          Text(
            'Support, just for you',
            style: TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w700,
              color: communityInk,
            ),
          ),
          SizedBox(height: 8),
          Text(
            'Only assigned professionals can contact you here. This space is separate from the public feed.',
            style: TextStyle(color: communityMuted, fontSize: 13, height: 1.6),
          ),
        ],
      ),
    ),
    const SizedBox(height: 16),
    if (threads.isEmpty)
      const CommunityEmpty(
        icon: Icons.mark_chat_unread_outlined,
        title: 'No care conversations yet.',
        description:
            'Private outreach from your care professionals will appear here.',
      ),
    for (final thread in threads)
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: CommunitySurface(
          padding: EdgeInsets.zero,
          child: ListTile(
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 8,
            ),
            leading: const CircleAvatar(
              backgroundColor: communityMint,
              child: Icon(Icons.support_agent_rounded, color: communityGreen),
            ),
            title: const Text(
              'Private care conversation',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: communityInk,
              ),
            ),
            subtitle: Text(
              thread['closed'] == true
                  ? 'Closed by your care professional'
                  : 'Open conversation',
              style: const TextStyle(fontSize: 12, color: communityMuted),
            ),
            trailing: const Icon(
              Icons.chevron_right_rounded,
              color: communityGreen,
            ),
            onTap: busy
                ? null
                : () => run(
                    () => openConversation(Map<String, dynamic>.from(thread)),
                  ),
          ),
        ),
      ),
    const SizedBox(height: 10),
    notificationSetting(),
  ]);

  Widget conversationContent() => scrolling([
    const CommunitySurface(
      color: communityMint,
      padding: EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.lock_outline_rounded, size: 18, color: communityGreen),
          SizedBox(width: 9),
          Expanded(
            child: Text(
              'Private conversation with your assigned care professional. Opening this conversation records that you have responded.',
              style: TextStyle(
                color: communityMuted,
                fontSize: 12,
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    ),
    const SizedBox(height: 20),
    for (final raw in messages) messageBubble(Map<String, dynamic>.from(raw)),
    if (messages.length >= 50)
      TextButton(
        onPressed: busy
            ? null
            : () => run(() async {
                final more =
                    await repo.get(
                          '/care/threads/${conversation!['id']}/messages?before=${messages.last['id']}',
                        )
                        as List;
                if (mounted) setState(() => messages.addAll(more));
              }),
        child: const Text('More messages'),
      ),
    if (conversation!['closed'] != true) ...[
      const SizedBox(height: 16),
      CommunitySurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Let your care team know',
              style: TextStyle(
                color: communityInk,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final item in [
                  ('okay', "I'm okay", Icons.check_circle_outline_rounded),
                  ('help', 'I need help', Icons.support_agent_rounded),
                ])
                  OutlinedButton.icon(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            await repo.send('/care/respond', {
                              'id': conversation!['id'],
                              'kind': item.$1,
                            });
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Your response has been sent.'),
                                ),
                              );
                            }
                          }),
                    icon: Icon(item.$3, size: 17),
                    label: Text(item.$2),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: busy
                  ? null
                  : () async {
                      final text = await textDialog('Reply privately');
                      if (text != null && mounted) {
                        await run(() async {
                          await repo.send('/care/messages', {
                            'id': conversation!['id'],
                            'body': text,
                          });
                          await openConversation(conversation!);
                        });
                      }
                    },
              style: FilledButton.styleFrom(backgroundColor: communityGreen),
              icon: const Icon(Icons.edit_outlined, size: 18),
              label: const Text('Write a reply'),
            ),
          ],
        ),
      ),
    ] else
      const CommunitySurface(
        child: Text(
          'This conversation has been closed by your care professional.',
          style: TextStyle(color: communityMuted),
        ),
      ),
  ]);

  Widget messageBubble(Map<String, dynamic> value) {
    final own = value['senderType'] == 'mother';
    return Padding(
      padding: EdgeInsets.only(
        left: own ? 24 : 0,
        right: own ? 0 : 24,
        bottom: 14,
      ),
      child: CommunitySurface(
        color: own ? communityMint : Colors.white,
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              own
                  ? 'You'
                  : value['senderType'] == 'system'
                  ? 'Care team'
                  : value['username'] as String? ?? 'Care professional',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: communityGreen,
              ),
            ),
            const SizedBox(height: 7),
            Text(
              value['body'] as String,
              style: const TextStyle(
                color: communityInk,
                height: 1.65,
                fontSize: 14,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
