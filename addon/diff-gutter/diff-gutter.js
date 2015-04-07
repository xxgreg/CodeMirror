// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// declare global: diff_match_patch, DIFF_INSERT, DIFF_DELETE, DIFF_EQUAL

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"), require("diff_match_patch"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror", "diff_match_patch"], mod);
  else // Plain browser env
    mod(CodeMirror, diff_match_patch);
})(function(CodeMirror, diff_match_patch) {
  "use strict";
  var Pos = CodeMirror.Pos;

  CodeMirror.defineExtension("diffEditor", function(options) {
    return new DiffEditor(this, options);
  });

  function DiffEditor(cm, options) {

    this.options = options;
    this.edit = cm;

    this.classes = {chunk: "CodeMirror-diff-chunk",
         start: "CodeMirror-diff-chunk-start",
         end: "CodeMirror-diff-chunk-end",
         insert: "CodeMirror-diff-inserted",
         del: "CodeMirror-diff-deleted",
         deletedLine: "CodeMirror-diff-deleted-line"}; // Show a line where content was deleted.

    //TODO I assume this is used in go next/prev diff.
    (this.edit.state.diffViews || (this.edit.state.diffViews = [])).push(this);

    this.origValue = options.orig;
    this.diff = getDiff(asString(options.orig), asString(options.value));
    this.chunks = getChunks(this.diff);
    this.diffOutOfDate = this.dealigned = false;
    this.showDifferences = options.showDifferences !== false;

    //TODO make this optional.
    //TODO annotations aren't working correctly as only content within the viewport
    // is being marked.
    // this.annotation = this.edit.annotateScrollbar({
    //   listenForChanges: false,
    //   className: "CodeMirror-scrollbar-diff-chunk"
    // });


// "gutterClick" (instance: CodeMirror, line: integer, gutter: string, clickEvent: Event)
// Fires when the editor gutter (the line-number area) is clicked. Will pass the editor instance as first argument, the (zero-based) number of the line that was clicked as second argument, the CSS class of the gutter that was clicked as third argument, and the raw mousedown event object as fourth argument.
// "gutterContextMenu" (instance: CodeMirror, line: integer, gutter: string, contextMenu: Event: Event)
// Fires when the editor gutter (the line-number area) receives a contextmenu event. Will pass the editor instance as first argument, the (zero-based) number of the line that was clicked as second argument, the CSS class of the gutter that was clicked as third argument, and the raw contextmenu mouse event object as fourth argument. You can preventDefault the event, to signal that CodeMirror should do no further handling.

    this.edit.on('gutterClick', function(cm, line, gutter, event) {
      console.log(cm, line, gutter, event);
    });

    this.forceUpdate = registerUpdate(this);
  }

  DiffEditor.prototype = {
    constructor: DiffEditor,
    editor: function() { return this.edit; },
    setShowDifferences: function(val) {
      val = val !== false;
      if (val != this.showDifferences) {
        this.showDifferences = val;
        this.forceUpdate("full");
      }
    }
  };

  function addGutterMarker(editor, line, option) {
    var el = document.createElement('div');
    var className = 'CodeMirror-diff-gutter';
    if (option) className += '-' + option;
    el.className = className;
    editor.setGutterMarker(line, 'diff', el);
  }

  function ensureDiff(dv) {
    if (dv.diffOutOfDate) {
      dv.diff = getDiff(dv.origValue, dv.edit.getValue());
      dv.chunks = getChunks(dv.diff);
      dv.diffOutOfDate = false;
      CodeMirror.signal(dv.edit, "updateDiff", dv.diff);
    }
  }

  var updating = false;
  function registerUpdate(dv) {
    var edit = {from: 0, to: 0, marked: []};
    var orig = {from: 0, to: 0, marked: []};
    var debounceChange, updatingFast = false;
    function update(mode) {
      updating = true;
      updatingFast = false;
      if (mode == "full") {
        clearMarks(dv.edit, edit.marked, dv.classes);
        edit.from = edit.to = orig.from = orig.to = 0;
      }
      ensureDiff(dv);
      if (dv.showDifferences) {
        updateMarks(dv.edit, dv.diff, edit, DIFF_INSERT, dv.classes, dv.annotation);
      }
      updating = false;
    }
    function setDealign(fast) {
      if (updating) return;
      dv.dealigned = true;
      set(fast);
    }
    function set(fast) {
      if (updating || updatingFast) return;
      clearTimeout(debounceChange);
      if (fast === true) updatingFast = true;
      debounceChange = setTimeout(update, fast === true ? 20 : 250);
    }
    function change(_cm, change) {
      if (!dv.diffOutOfDate) {
        dv.diffOutOfDate = true;
        edit.from = edit.to = orig.from = orig.to = 0;
      }
      // Update faster when a line was added/removed
      setDealign(change.text.length - 1 != change.to.line - change.from.line);
    }
    dv.edit.on("change", change);
    dv.edit.on("markerAdded", setDealign);
    dv.edit.on("markerCleared", setDealign);
    dv.edit.on("viewportChange", function() { set(false); });
    update();
    return update;
  }

  function getOffsets(editor, around) {
    var bot = around.after;
    if (bot == null) bot = editor.lastLine() + 1;
    return {top: editor.heightAtLine(around.before || 0, "local"),
            bot: editor.heightAtLine(bot, "local")};
  }

  function clearMarks(editor, arr, classes, annotation) {
    // TODO Clear scrollbarAnnotations
    //if (annotation.div.parentNode != null) annotation.clear();

    editor.clearGutter('diff');
    // Clear line marks.
    // for (var i = 0; i < arr.length; ++i) {
    //   var mark = arr[i];
    //   if (mark instanceof CodeMirror.TextMarker) {
    //     mark.clear();
    //   } else if (mark.parent) {
    //     editor.removeLineClass(mark, "background", classes.chunk);
    //     editor.removeLineClass(mark, "background", classes.start);
    //     editor.removeLineClass(mark, "background", classes.end);
    //     editor.removeLineClass(mark, "background", classes.deletedLine);
    //   }
    // }
    // arr.length = 0;
  }

  // FIXME maybe add a margin around viewport to prevent too many updates
  function updateMarks(editor, diff, state, type, classes, annotation) {
    var vp = editor.getViewport();
    editor.operation(function() {
      if (state.from == state.to || vp.from - state.to > 20 || state.from - vp.to > 20) {
        clearMarks(editor, state.marked, classes, annotation);
        markChanges(editor, diff, type, state.marked, vp.from, vp.to, classes, annotation);
        state.from = vp.from; state.to = vp.to;
      } else {
        if (vp.from < state.from) {
          markChanges(editor, diff, type, state.marked, vp.from, state.from, classes, annotation);
          state.from = vp.from;
        }
        if (vp.to > state.to) {
          markChanges(editor, diff, type, state.marked, state.to, vp.to, classes, annotation);
          state.to = vp.to;
        }
      }
    });
  }

  function markChanges(editor, diff, type, marks, from, to, classes, annotation) {
    var pos = Pos(0, 0);
    var top = Pos(from, 0), bot = editor.clipPos(Pos(to - 1));
    var cls = type == DIFF_DELETE ? classes.del : classes.insert;
    var annotationRanges = [];

    function markChunk(start, end, type) {
      var bfrom = Math.max(from, start), bto = Math.min(to, end);
      for (var i = bfrom; i < bto; ++i) {
        //var line = editor.addLineClass(i, "background", classes.chunk);
        addGutterMarker(editor, i);
        //Not used at the moment.
        // if (i == start) editor.addLineClass(line, "background", classes.start);
        // if (i == end - 1) editor.addLineClass(line, "background", classes.end);
        //marks.push(line);
      }
      // When the chunk is empty, make sure a horizontal line shows up
      if (start == end && bfrom == end && bto == end) {
        if (bfrom) {
          //marks.push(editor.addLineClass(bfrom - 1, "background", classes.deletedLine));
          //annotationRanges.push({from: Pos(bfrom - 1, 0), to: Pos(bfrom, 0)});
          addGutterMarker(editor, bfrom - 1, "removed");
        } else {
          //marks.push(editor.addLineClass(bfrom, "background", classes.deletedLine));
          //annotationRanges.push({from: Pos(bfrom, 0), to: Pos(bfrom + 1, 0)});
          addGutterMarker(editor, bfrom, "removed");
        }
      }
    }
    
    var chunkStart = 0;
    for (var i = 0; i < diff.length; ++i) {
      var part = diff[i], tp = part[0], str = part[1];
      if (tp == DIFF_EQUAL) {
        var cleanFrom = pos.line + (startOfLineClean(diff, i) ? 0 : 1);
        moveOver(pos, str);
        var cleanTo = pos.line + (endOfLineClean(diff, i) ? 1 : 0);
        if (cleanTo > cleanFrom) {
          if (i) markChunk(chunkStart, cleanFrom);
          chunkStart = cleanTo;
        }
      } else {        
        if (tp == type) {
          var end = moveOver(pos, str, true);
          var a = posMax(top, pos), b = posMin(bot, end);
          if (!posEq(a, b)) {
            //  marks.push(editor.markText(a, b, {className: cls}));
            //annotationRanges.push({from: Pos(a.line, 0), to: Pos(b.line, 0)});
          }
          pos = end;
        }
      }
    }
    if (chunkStart <= pos.line) markChunk(chunkStart, pos.line + 1);

    //annotation.update(annotationRanges);
  }

  function asString(obj) {
    if (typeof obj == "string") return obj;
    else return obj.getValue();
  }

  // Operations on diffs

  var dmp = new diff_match_patch();
  function getDiff(a, b) {
    var diff = dmp.diff_main(a, b);
    dmp.diff_cleanupSemantic(diff);
    // The library sometimes leaves in empty parts, which confuse the algorithm
    for (var i = 0; i < diff.length; ++i) {
      var part = diff[i];
      if (!part[1]) {
        diff.splice(i--, 1);
      } else if (i && diff[i - 1][0] == part[0]) {
        diff.splice(i--, 1);
        diff[i][1] += part[1];
      }
    }
    return diff;
  }

  function getChunks(diff) {
    var chunks = [];
    var startEdit = 0, startOrig = 0;
    var edit = Pos(0, 0), orig = Pos(0, 0);
    for (var i = 0; i < diff.length; ++i) {
      var part = diff[i], tp = part[0];
      if (tp == DIFF_EQUAL) {
        var startOff = startOfLineClean(diff, i) ? 0 : 1;
        var cleanFromEdit = edit.line + startOff, cleanFromOrig = orig.line + startOff;
        moveOver(edit, part[1], null, orig);
        var endOff = endOfLineClean(diff, i) ? 1 : 0;
        var cleanToEdit = edit.line + endOff, cleanToOrig = orig.line + endOff;
        if (cleanToEdit > cleanFromEdit) {
          if (i) chunks.push({origFrom: startOrig, origTo: cleanFromOrig,
                              editFrom: startEdit, editTo: cleanFromEdit});
          startEdit = cleanToEdit; startOrig = cleanToOrig;
        }
      } else {
        moveOver(tp == DIFF_INSERT ? edit : orig, part[1]);
      }
    }
    if (startEdit <= edit.line || startOrig <= orig.line)
      chunks.push({origFrom: startOrig, origTo: orig.line + 1,
                   editFrom: startEdit, editTo: edit.line + 1});
    return chunks;
  }

  function endOfLineClean(diff, i) {
    if (i == diff.length - 1) return true;
    var next = diff[i + 1][1];
    if (next.length == 1 || next.charCodeAt(0) != 10) return false;
    if (i == diff.length - 2) return true;
    next = diff[i + 2][1];
    return next.length > 1 && next.charCodeAt(0) == 10;
  }

  function startOfLineClean(diff, i) {
    if (i == 0) return true;
    var last = diff[i - 1][1];
    if (last.charCodeAt(last.length - 1) != 10) return false;
    if (i == 1) return true;
    last = diff[i - 2][1];
    return last.charCodeAt(last.length - 1) == 10;
  }

  // General utilities

  function copyObj(obj, target) {
    if (!target) target = {};
    for (var prop in obj) if (obj.hasOwnProperty(prop)) target[prop] = obj[prop];
    return target;
  }

  function moveOver(pos, str, copy, other) {
    var out = copy ? Pos(pos.line, pos.ch) : pos, at = 0;
    for (;;) {
      var nl = str.indexOf("\n", at);
      if (nl == -1) break;
      ++out.line;
      if (other) ++other.line;
      at = nl + 1;
    }
    out.ch = (at ? 0 : out.ch) + (str.length - at);
    if (other) other.ch = (at ? 0 : other.ch) + (str.length - at);
    return out;
  }

  function posMin(a, b) { return (a.line - b.line || a.ch - b.ch) < 0 ? a : b; }
  function posMax(a, b) { return (a.line - b.line || a.ch - b.ch) > 0 ? a : b; }
  function posEq(a, b) { return a.line == b.line && a.ch == b.ch; }

  function findPrevDiff(chunks, start, isOrig) {
    for (var i = chunks.length - 1; i >= 0; i--) {
      var chunk = chunks[i];
      var to = (isOrig ? chunk.origTo : chunk.editTo) - 1;
      if (to < start) return to;
    }
  }

  function findNextDiff(chunks, start, isOrig) {
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i];
      var from = (isOrig ? chunk.origFrom : chunk.editFrom);
      if (from > start) return from;
    }
  }

  function goNearbyDiff(cm, dir) {
    var found = null, views = cm.state.diffViews, line = cm.getCursor().line;
    if (views) for (var i = 0; i < views.length; i++) {
      var dv = views[i], isOrig = cm == dv.orig; //FIXME
      ensureDiff(dv);
      var pos = dir < 0 ? findPrevDiff(dv.chunks, line, isOrig) : findNextDiff(dv.chunks, line, isOrig);
      if (pos != null && (found == null || (dir < 0 ? pos > found : pos < found)))
        found = pos;
    }
    if (found != null)
      cm.setCursor(found, 0);
    else
      return CodeMirror.Pass;
  }

  CodeMirror.commands.goNextDiff = function(cm) {
    return goNearbyDiff(cm, 1);
  };
  CodeMirror.commands.goPrevDiff = function(cm) {
    return goNearbyDiff(cm, -1);
  };
});
