import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import 'community_repository.dart';
import 'community_push.dart';

class CommunityPage extends StatefulWidget {
  const CommunityPage({super.key, required this.repository, this.push});
  final CommunityRepository repository;
  final CommunityPush? push;
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
  String? selectedTag, error;
  bool busy = false, inbox = false, available = true, ownPosts = false;
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
      await loadFeed();
      if ((widget.push?.inboxRequests.value ?? 0) > 0) {
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
    if (ownPosts) {
      if (mounted) {
        setState(() {
          post = value;
          comments = [];
          replies.clear();
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
      });
    }
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
    final title = TextEditingController(
      text: existing?['title'] as String? ?? '',
    );
    final body = TextEditingController(
      text: existing?['body'] as String? ?? '',
    );
    final selected = <String>{
      for (final t in existing?['tags'] as List? ?? []) t['id'] as String,
    };
    final key = communityRequestKey();
    final submitted = await showDialog<bool>(
      context: context,
      useRootNavigator: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(existing == null ? 'Share a post' : 'Edit post'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: title,
                  maxLength: 200,
                  decoration: const InputDecoration(labelText: 'Title'),
                ),
                TextField(
                  controller: body,
                  maxLines: 5,
                  maxLength: 10000,
                  decoration: const InputDecoration(
                    labelText: 'Your post',
                    hintText: 'Avoid identifying details.',
                  ),
                ),
                Wrap(
                  spacing: 6,
                  children: [
                    for (final tag in tags)
                      FilterChip(
                        label: Text(tag['name'] as String),
                        selected: selected.contains(tag['id']),
                        onSelected: (value) => update(() {
                          if (value) {
                            selected.add(tag['id'] as String);
                          } else {
                            selected.remove(tag['id']);
                          }
                        }),
                      ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (title.text.trim().isNotEmpty &&
                    body.text.trim().isNotEmpty) {
                  Navigator.pop(dialogContext, true);
                }
              },
              child: const Text('Submit for review'),
            ),
          ],
        ),
      ),
    );
    final data = {
      'title': title.text.trim(),
      'body': body.text.trim(),
      'tags': selected.toList(),
      if (existing != null) 'id': existing['id'],
    };
    Future<void>.delayed(const Duration(milliseconds: 400), () {
      title.dispose();
      body.dispose();
    });
    if (submitted != true || !mounted) return;
    await run(() async {
      await repo.send(
        existing == null ? '/posts' : '/posts/edit',
        data,
        key: key,
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Submitted. Your post will appear after review.'),
          ),
        );
      }
      await loadFeed();
    });
  }

  Future<void> reply({
    Map<String, dynamic>? parent,
    Map<String, dynamic>? edit,
  }) async {
    final text = await textDialog(
      edit == null ? 'Write a reply' : 'Edit reply',
      initial: edit?['body'] as String? ?? '',
    );
    if (text == null || !mounted) return;
    await run(() async {
      await repo.send(
        edit == null ? '/comments' : '/comments/edit',
        edit == null
            ? {'postId': post!['id'], 'parentId': parent?['id'], 'body': text}
            : {'id': edit['id'], 'body': text},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Reply submitted for review.')),
        );
      }
      await loadThread(post!);
    });
  }

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

  Widget commentCard(Map<String, dynamic> value, [int depth = 0]) => Padding(
    padding: EdgeInsets.only(left: depth > 0 ? 12 : 0),
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value['username'] as String? ?? 'Removed',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            Text(value['body'] as String? ?? ''),
            Wrap(
              children: [
                TextButton(
                  onPressed: busy ? null : () => reply(parent: value),
                  child: const Text('Reply'),
                ),
                if (value['removed'] != true)
                  TextButton(
                    onPressed: busy ? null : () => report(value, 'comment'),
                    child: const Text('Report'),
                  ),
                if (value['owned'] == true && value['removed'] != true) ...[
                  TextButton(
                    onPressed: busy ? null : () => reply(edit: value),
                    child: const Text('Edit'),
                  ),
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            await repo.send('/comments/remove', {
                              'id': value['id'],
                            });
                            await loadThread(post!);
                          }),
                    child: const Text('Remove'),
                  ),
                ],
                if (value['hasReplies'] == true)
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            final list =
                                await repo.get(
                                      '/posts/${post!['id']}/comments?parentId=${value['id']}',
                                    )
                                    as List;
                            if (mounted) {
                              setState(
                                () => replies[value['id'] as String] = list,
                              );
                            }
                          }),
                    child: const Text('View replies'),
                  ),
              ],
            ),
            for (final child in replies[value['id']] ?? [])
              commentCard(Map<String, dynamic>.from(child), depth + 1),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          conversation != null
              ? 'Care conversation'
              : post != null
              ? 'Discussion'
              : 'Community',
        ),
        leading: post != null || conversation != null
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () {
                  poll?.cancel();
                  setState(() {
                    post = null;
                    conversation = null;
                    messages = [];
                  });
                  unawaited(run(inbox ? loadInbox : loadFeed));
                },
              )
            : null,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: busy
                ? null
                : () => run(() async {
                    if (conversation != null) {
                      await openConversation(conversation!);
                    } else if (post != null) {
                      await loadThread(post!);
                    } else if (inbox) {
                      await loadInbox();
                    } else {
                      await loadFeed();
                    }
                  }),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          Expanded(child: buildContent()),
        ],
      ),
    );
  }

  Widget buildContent() {
    if (notice == null) {
      return Center(
        child: TextButton(
          onPressed: busy ? null : start,
          child: const Text('Retry'),
        ),
      );
    }
    if (!available) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Community support is not available yet. Contact your clinic directly for help.',
          ),
        ),
      );
    }
    if (member == null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text(
            'Before you join',
            style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Text(notice!['text'] as String),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: busy
                ? null
                : () => run(() async {
                    await repo.enrol(notice!['version'] as String);
                    final me = Map<String, dynamic>.from(await repo.get('/me'));
                    if (mounted) setState(() => member = me);
                    await loadFeed();
                  }),
            child: const Text('I understand and agree'),
          ),
        ],
      );
    }
    if (conversation != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Private conversation with your assigned care professional. Opening this conversation records that you have responded.',
          ),
          for (final m in messages)
            Card(
              child: ListTile(
                title: Text(
                  m['senderType'] == 'system'
                      ? 'Care team'
                      : m['username'] as String? ?? 'Care professional',
                ),
                subtitle: Text(m['body'] as String),
              ),
            ),
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
            Wrap(
              spacing: 8,
              children: [
                for (final item in [
                  ('okay', "I'm okay"),
                  ('help', 'I need help'),
                ])
                  OutlinedButton(
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
                    child: Text(item.$2),
                  ),
              ],
            ),
            FilledButton(
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
              child: const Text('Write a reply'),
            ),
          ] else
            const Text(
              'This conversation has been closed by your care professional.',
            ),
        ],
      );
    }
    if (post != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            post!['title'] as String,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
          ),
          Text(post!['username'] as String),
          const SizedBox(height: 12),
          Text(post!['body'] as String),
          Wrap(
            children: [
              TextButton(
                onPressed: busy ? null : () => reply(),
                child: const Text('Reply'),
              ),
              TextButton(
                onPressed: busy ? null : () => report(post!, 'post'),
                child: const Text('Report'),
              ),
              if (post!['owned'] == true) ...[
                TextButton(
                  onPressed: busy ? null : () => composePost(existing: post),
                  child: const Text('Edit'),
                ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () => run(() async {
                          await repo.send('/posts/remove', {'id': post!['id']});
                          if (mounted) setState(() => post = null);
                          await loadFeed();
                        }),
                  child: const Text('Remove'),
                ),
                TextButton(
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
                  child: const Text('I need help now'),
                ),
              ],
            ],
          ),
          for (final c in comments) commentCard(Map<String, dynamic>.from(c)),
          if (comments.length >= 20)
            TextButton(
              onPressed: busy
                  ? null
                  : () => run(() async {
                      final more =
                          await repo.get(
                                '/posts/${post!['id']}/comments?before=${comments.last['id']}',
                              )
                              as List;
                      if (mounted) setState(() => comments.addAll(more));
                    }),
              child: const Text('More comments'),
            ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Posting as ${member!['username']}',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              label: const Text('Posts'),
              selected: !inbox,
              onSelected: busy
                  ? null
                  : (_) => run(() async {
                      setState(() => inbox = false);
                      await loadFeed();
                    }),
            ),
            ChoiceChip(
              label: const Text('Care inbox'),
              selected: inbox,
              onSelected: busy ? null : (_) => run(loadInbox),
            ),
          ],
        ),
        if (widget.push != null)
          ValueListenableBuilder<bool>(
            valueListenable: widget.push!.enabled,
            builder: (context, value, _) => SwitchListTile(
              title: const Text('Generic message notifications'),
              subtitle: const Text(
                'Notification previews never include your messages.',
              ),
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
        if (inbox) ...[
          const Text('Only assigned professionals can contact you here.'),
          if (threads.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No care conversations yet.'),
            ),
          for (final thread in threads)
            Card(
              child: ListTile(
                title: const Text('Private care conversation'),
                subtitle: Text(thread['closed'] == true ? 'Closed' : 'Open'),
                trailing: const Icon(Icons.chevron_right),
                onTap: busy
                    ? null
                    : () => run(
                        () =>
                            openConversation(Map<String, dynamic>.from(thread)),
                      ),
              ),
            ),
        ] else ...[
          Wrap(
            spacing: 6,
            children: [
              ChoiceChip(
                label: const Text('All topics'),
                selected: selectedTag == null,
                onSelected: busy
                    ? null
                    : (_) => run(() async {
                        setState(() => selectedTag = null);
                        await loadFeed();
                      }),
              ),
              for (final tag in tags)
                ChoiceChip(
                  label: Text(tag['name'] as String),
                  selected: selectedTag == tag['id'],
                  onSelected: busy
                      ? null
                      : (_) => run(() async {
                          setState(() => selectedTag = tag['id'] as String);
                          await loadFeed();
                        }),
                ),
            ],
          ),
          FilledButton.icon(
            onPressed: busy ? null : () => composePost(),
            icon: const Icon(Icons.edit_outlined),
            label: const Text('Share a post'),
          ),
          SwitchListTile(
            title: const Text('My posts, including pending review'),
            value: ownPosts,
            onChanged: busy
                ? null
                : (value) => run(() async {
                    setState(() => ownPosts = value);
                    await loadFeed();
                  }),
          ),
          if (posts.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No published posts yet.'),
            ),
          for (final p in posts)
            Card(
              child: ListTile(
                title: Text(p['title'] as String),
                subtitle: Text(
                  '${p['username']} · ${p['replyCount']} replies\n${p['body']}',
                ),
                isThreeLine: true,
                onTap: busy
                    ? null
                    : () => run(() => loadThread(Map<String, dynamic>.from(p))),
              ),
            ),
          if (!ownPosts && posts.length >= 20)
            TextButton(
              onPressed: busy ? null : () => run(() => loadFeed(more: true)),
              child: const Text('More posts'),
            ),
        ],
      ],
    );
  }
}
